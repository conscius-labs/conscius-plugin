/**
 * The end-of-task reminder's logic, shared by every harness (CL-2a).
 *
 * Each adapter turns its harness's transcript into a list of tool calls in
 * the order they were made:
 *   { tool: "lookup" | "search" | "propose" | "web", input, result }
 * (result is the tool's output as text; other tools are left out) and asks
 * decide() whether to remind. The adapters for Claude Code
 * (propose-reminder.mjs), Codex (../codex/stop.mjs) and Gemini CLI
 * (../gemini/after-agent.mjs) only read input and write the answer in their
 * harness's shape.
 *
 * The reminder fires when:
 *   - a Conscius lookup or search came back not found, with a property
 *     missing, or with a fact single-source, contested, stale or a record (narrowed by the
 *     policy's remind_for, CL-6);
 *   - the agent then used the web;
 *   - it hasn't called conscius_propose.
 * The agent stays the author: the reminder only asks; it never proposes
 * anything itself, and it repeats the rules about what may not be proposed.
 */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A lookup left something to verify: the thing wasn't found, a property had
 * no fact, or a fact isn't agreed. Words the store didn't know as
 * properties ("unmatched") don't count: they're usually other names for a
 * property it answered (brief 22 §2).
 */
export function isUnsettled(text, scope = "unsettled") {
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    if (/"person":\s*true/.test(text)) return false;
    if (scope === "wanted") return /"wanted_missing"/.test(text);
    if (scope === "missing") return /"found":\s*false|"missing"/.test(text);
    return /"found":\s*false|"missing"|"status":\s*"(single-source|contested|stale|record)"/.test(text);
  }
  if (r.person) return false; // a person's name: Conscius holds no facts about people, so there's nothing to propose (brief 09)
  // CL-6: the policy's remind_for narrows what counts. "wanted": missing facts others also need; "missing": any missing fact or thing.
  if (scope === "wanted") return Boolean(r.wanted_missing?.length);
  if (scope === "missing") return r.found === false || Boolean(r.missing?.length);
  const lists = r.results ? r.results.map((x) => x.top_facts ?? []) : [r.facts ?? []];
  return r.found === false || Boolean(r.missing?.length) || lists.some((fs) => fs.some((f) => f.status && f.status !== "agreed"));
}

/**
 * WR-16: a web call that only opened Conscius's own pages (consci.us, its GitHub organization) isn't a
 * check on the web: a fact "verified" there came from Conscius. Kept in step with server/sources.mjs's
 * OWN_SITES. A call whose input names no URL (a search) is web use as before.
 */
export function ownPagesOnly(input) {
  const urls = JSON.stringify(input ?? "").match(/https?:\/\/[^\s"'<>\\]+/g) ?? [];
  return urls.length > 0 && urls.every((u) => /^https?:\/\/([\w-]+\.)*consci\.us(?=[/:?#]|$)|^https?:\/\/(www\.)?(github\.com|raw\.githubusercontent\.com)\/conscius-labs(?=[/?#]|$)/i.test(u));
}

/** The words the reminder asks with; `proposeHint` says how this harness reaches conscius_propose. */
export function reminderText(unsettled, { proposeHint = "conscius_propose (load it with ToolSearch if needed)", last = false } = {}) {
  const items = [...new Set(unsettled)];
  const more = items.length > 4 ? ` and ${items.length - 4} more` : "";
  return [
    `Before you finish: Conscius was missing or unsure about ${items.slice(0, 4).join("; ")}${more}, and you then checked the web.`,
    `If you only saw search results, open the best source page now (one fetch) and check the fact there. For each fact a page you opened confirms, propose it now with ${proposeHint}: subject, property, value, source_url, and the sentence on the page that states it. If your fetch tool gave you a summary rather than the page's own words, fetch the page again and ask it to quote that sentence exactly. One call stores it.`,
    "Don't propose anything from memory or from search snippets alone, from pages behind a login, or about private individuals. If a page contradicts your answer, tell the user. If there's nothing to propose, or conscius_propose isn't available or is refused, finish without repeating your answer; never look for another way to send it.",
    ...(last ? ["This is the last such reminder in this session."] : []),
  ].join(" ");
}

/**
 * Whether to remind, from the normalized calls. Returns
 * { fire, reason?, unsettled, webAfter, proposed, at } (the counts go to the experiments' log).
 *
 * CL-7: only lookups from position `since` on count (what an earlier
 * reminder in the session already asked about is left alone), and a
 * proposal counts only after the first of them. `at` is where the next
 * reminder starts from; `last` adds that this is the session's last reminder.
 */
export function decide(calls, { remindFor = "unsettled", proposeHint, since = 0, last = false } = {}) {
  const unsettled = [];
  let firstUnsettled = Infinity;
  let webAfter = false;
  let proposed = false;
  calls.forEach((c, i) => {
    if (c.tool === "web" && i > firstUnsettled && !ownPagesOnly(c.input)) webAfter = true;
    if (c.tool === "propose" && i > firstUnsettled) proposed = true;
    if (i < since) return;
    if ((c.tool === "lookup" || c.tool === "search") && c.result != null && isUnsettled(String(c.result), remindFor)) {
      firstUnsettled = Math.min(firstUnsettled, i);
      const what = c.input?.entity ?? c.input?.query ?? "a fact";
      const props = Array.isArray(c.input?.properties) && c.input.properties.length ? ` (${c.input.properties.join(", ")})` : "";
      unsettled.push(`${what}${props}`);
    }
  });
  if (!unsettled.length || !webAfter || proposed) return { fire: false, unsettled: unsettled.length, webAfter, proposed, at: calls.length };
  return { fire: true, reason: reminderText(unsettled, { proposeHint, last }), unsettled, at: calls.length };
}

/**
 * The session's reminder count and where the last reminder left off (CL-7),
 * in a small file in the temp folder named by a hash of the session ID:
 * nothing about what was looked up.
 */
export function sessionState(sessionId) {
  const file = path.join(tmpdir(), `conscius-reminded-${createHash("sha256").update(String(sessionId ?? "")).digest("hex").slice(0, 16)}.json`);
  let state = { count: 0, since: 0 };
  if (sessionId) {
    try {
      const s = JSON.parse(readFileSync(file, "utf8"));
      if (Number.isInteger(s.count) && Number.isInteger(s.since)) state = s;
    } catch {}
  }
  return {
    ...state,
    record(at) {
      if (!sessionId) return;
      try {
        writeFileSync(file, JSON.stringify({ count: state.count + 1, since: at }));
      } catch {} // without the file, each reminder still names everything unsettled, as before
    },
  };
}

/**
 * The whole decision for an adapter: the policy's opt-in and cap, the
 * session's state, then decide(). Returns decide()'s result plus `why` when
 * it didn't get that far.
 */
export function remindFor(calls, { policy, sessionId, proposeHint }) {
  const state = sessionState(sessionId);
  if (state.count >= policy.max_reminders) return { fire: false, why: `cap reached (${state.count} of ${policy.max_reminders})` };
  const r = decide(calls, { remindFor: policy.remind_for, proposeHint, since: state.since, last: state.count + 1 >= policy.max_reminders });
  if (r.fire) state.record(r.at);
  return r;
}

/** Which Conscius tool a harness's tool name is, if any: "mcp__conscius__conscius_lookup", "mcp_conscius_conscius_lookup", "conscius_lookup"… */
export function consciusTool(name) {
  // any separator before it: mcp__conscius__conscius_lookup, conscius-conscius_lookup, conscius/conscius_lookup (Copilot's MCP names aren't documented)
  return /(?:^|[_\-/.:])conscius_(lookup|search|propose)$/.exec(String(name ?? ""))?.[1] ?? null;
}

/**
 * A tool result's text, whatever wrapper the harness put around it: MCP
 * content blocks, a JSON string of them, Gemini's function-response parts,
 * Codex's input_text items. A Conscius answer (a JSON object) is returned as is.
 */
export function resultText(x) {
  if (x == null) return "";
  if (typeof x === "string") {
    let parsed;
    try {
      parsed = JSON.parse(x);
    } catch {
      return x;
    }
    // A wrapper (an array, or an object holding content or output) is opened; anything else is the answer itself.
    if (Array.isArray(parsed) || (parsed && typeof parsed === "object" && ("content" in parsed || "output" in parsed || "functionResponse" in parsed) && !("facts" in parsed || "found" in parsed || "results" in parsed))) return resultText(parsed);
    return x;
  }
  if (Array.isArray(x)) return x.map(resultText).join("");
  if (typeof x === "object") {
    if (x.functionResponse) return resultText(x.functionResponse.response ?? "");
    if ("output" in x) return resultText(x.output);
    if ("content" in x) return resultText(x.content);
    if (typeof x.text === "string") return x.text;
    if (x.Ok) return resultText(x.Ok); // Codex's Result<CallToolResult, String>
    if (typeof x.Err === "string") return x.Err;
    return JSON.stringify(x);
  }
  return String(x);
}

/** For experiments only: when CONSCIUS_HOOK_LOG names a file, record each decision there. */
export function log(entry) {
  if (!process.env.CONSCIUS_HOOK_LOG) return;
  appendFileSync(process.env.CONSCIUS_HOOK_LOG, JSON.stringify(entry) + "\n");
}

/**
 * Whether a module is the script node was started with. Compares real paths,
 * not URLs: a plugin under a symlinked folder (macOS's /var is /private/var)
 * or a path with spaces would otherwise never run its hook.
 */
export function isMain(moduleUrl) {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
