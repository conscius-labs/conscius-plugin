/**
 * Conscius plugin for OpenCode V2 (CL-2): the same end-of-task reminder and
 * proposal screen as Claude Code's, on reminder-core.mjs.
 *
 * OpenCode's plugins run in its server process, not as scripts. This one is
 * V2's shape (`{ id, setup }`, what `Plugin.define` returns; read from
 * @opencode/plugin's README and promise/*.ts at v2.2.5, 2026-10-31; the
 * public docs at opencode.ai/v2/docs/build/plugins/server list the tool
 * hooks but not the idle one). It imports nothing from OpenCode, so it
 * loads from `.opencode/plugins/` or the `plugins` list in opencode.json.
 *
 *   tool "execute.after"      notes each Conscius and web call, per session, in memory.
 *                             MCP tools are named `<server>_<tool>`, so conscius_conscius_lookup.
 *   tool "execute.before"     screens conscius_propose; throwing rejects that call alone,
 *                             and the model sees the message. A tool hook can't ask the
 *                             user, so a policy of "ask" refuses with that reason (the
 *                             screen's canAsk: false, as for harnesses without a prompt).
 *   session "experimental.idle"  runs when a session finishes with no pending input; a
 *                             synthetic message admitted there runs in the same execution.
 *                             It's experimental in OpenCode: its name and shape may change.
 *
 * The idle hook runs again after the reminder's own turn, so the loop is
 * bounded by reminder-core's session state (a reminder only asks about
 * lookups after the last one, and stops at the policy's cap). It waits while
 * the session's own shells or subagents still run, since their notices wake
 * the session again. Built from OpenCode's source; not yet run in a real OpenCode.
 */
import { loadPolicy } from "../hooks/policy.mjs";
import { consciusTool, log, remindFor, resultText } from "../hooks/reminder-core.mjs";
import { screenProposal } from "../hooks/screen-proposal.mjs";

/** OpenCode's web tools (core/src/tool/plugin: webfetch, websearch), and shell commands that fetch a URL. */
const WEB = new Set(["webfetch", "websearch"]);
const FETCH = /\b(curl|wget|http(ie)?|Invoke-WebRequest|iwr)\b[^\n]*https?:\/\//i;

/** An execute.after event as a normalized call ({ tool, input, result }), or null if the reminder doesn't count it. */
export function callOf(event) {
  const name = String(event.tool ?? "");
  const input = event.input && typeof event.input === "object" ? event.input : {};
  const tool = consciusTool(name);
  if (tool) {
    if (event.status !== "completed") return { tool, input, result: tool === "propose" ? "" : null }; // a failed lookup settles nothing
    return { tool, input, result: resultText(event.result?.content ?? event.result?.output ?? event.result) };
  }
  if (name === "shell" || name === "bash") return FETCH.test(input.command ?? "") ? { tool: "web", input } : null;
  return WEB.has(name) ? { tool: "web", input } : null;
}

/** The idle hook's answer: the reminder's text, or why not. */
export function idleAnswer(event, calls, { policy }) {
  if (event.background?.some((w) => w.sessionID === event.sessionID && (w.kind === "subagent" || w.kind === "shell"))) return { why: "background work still running" };
  if (!policy.remind) return { why: policy.write_back === "off" ? "write-back off by policy" : "write-back not turned on (opt-in)" };
  const { fire, reason, ...counts } = remindFor(calls, { policy, sessionId: event.sessionID, proposeHint: "the conscius_propose tool" });
  return fire ? { text: reason, counts } : { counts };
}

/** The screen's answer for an execute.before event: null to let it through, or the message to reject it with. */
export async function screenAnswer(event, cwd) {
  if (consciusTool(event.tool) !== "propose") return null;
  const v = await screenProposal({ tool_name: event.tool, tool_input: event.input ?? {}, cwd, session_id: event.sessionID }, { canAsk: false }).catch(() => null);
  return v?.decision === "deny" ? v.reason : null;
}

export default {
  id: "conscius",
  async setup(ctx) {
    const cwd = ctx.location?.directory ?? process.cwd();
    const sessions = new Map(); // session ID → normalized calls; nothing leaves this process
    await ctx.tool.hook("execute.after", (event) => {
      try {
        const call = callOf(event);
        if (!call || !event.sessionID) return;
        if (!sessions.has(event.sessionID)) sessions.set(event.sessionID, []);
        sessions.get(event.sessionID).push(call);
      } catch {} // a hook that fails must never get in the agent's way
    });
    await ctx.tool.hook("execute.before", async (event) => {
      const reason = await screenAnswer(event, cwd).catch(() => null);
      if (reason) throw new Error(reason);
    });
    await ctx.session.hook("experimental.idle", async (event) => {
      let a;
      try {
        a = idleAnswer(event, sessions.get(event.sessionID) ?? [], { policy: loadPolicy(cwd).policy });
        log({ harness: "opencode", fired: Boolean(a.text), ...(a.why ? { why: a.why } : a.counts) });
        if (a.counts?.why?.startsWith("cap reached")) sessions.delete(event.sessionID);
      } catch {
        return;
      }
      // A failing idle hook fails the session's execution, so the reminder never throws.
      if (a.text) await ctx.session.synthetic({ sessionID: event.sessionID, text: a.text, description: "Conscius reminder" }).catch(() => {});
    });
    return () => sessions.clear();
  },
};
