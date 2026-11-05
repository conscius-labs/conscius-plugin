/**
 * The Copilot adapter's call log (CL-8). Copilot's agentStop hook gives a
 * transcript path but its docs don't describe the file (docs.github.com
 * copilot/reference/hooks-configuration, checked 2026-10-31), so, as for
 * Cursor, postToolUse appends each Conscius or web call, normalized as
 * reminder-core.mjs's decide() wants, to a file in the temp folder named by a
 * hash of the session ID; agentStop reads it. It stays on this machine and is
 * deleted when the session's reminder cap is reached.
 */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { consciusTool, resultText } from "../hooks/reminder-core.mjs";

export const callsFile = (sessionId) => path.join(tmpdir(), `conscius-copilot-${createHash("sha256").update(String(sessionId ?? "")).digest("hex").slice(0, 16)}.jsonl`);

const parse = (s) => {
  if (s && typeof s === "object") return s;
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};
/** Copilot's web tools (its tool-name table: web_fetch; web_search in its runtime names), and shell commands that fetch a URL. */
const WEB = new Set(["web_fetch", "web_search", "fetch", "search"]);
const FETCH = /\b(curl|wget|http(ie)?|Invoke-WebRequest|iwr)\b[^\n]*https?:\/\//i;

/** The event's fields in either of Copilot's formats (camelCase, or VS Code's snake_case). */
const fields = (e) => ({
  sessionId: e.sessionId ?? e.session_id,
  toolName: String(e.toolName ?? e.tool_name ?? ""),
  toolArgs: parse(e.toolArgs ?? e.tool_input),
  result: e.toolResult?.textResultForLlm ?? e.tool_result?.text_result_for_llm ?? e.toolResult ?? e.tool_result,
});

/** A postToolUse event as a normalized call ({ tool, input, result }), or null if the reminder doesn't count it. */
export function callOf(event) {
  const { toolName, toolArgs, result } = fields(event);
  const tool = consciusTool(toolName);
  if (tool) return { tool, input: toolArgs, result: resultText(result) };
  if (toolName === "bash" || toolName === "powershell") return FETCH.test(toolArgs.command ?? "") ? { tool: "web", input: toolArgs } : null;
  return WEB.has(toolName) ? { tool: "web", input: toolArgs } : null;
}

export function record(event) {
  const call = callOf(event);
  const { sessionId } = fields(event);
  if (!call || !sessionId) return false;
  appendFileSync(callsFile(sessionId), JSON.stringify(call) + "\n");
  return true;
}

export function readCalls(sessionId) {
  try {
    return readFileSync(callsFile(sessionId), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export const forget = (sessionId) => rmSync(callsFile(sessionId), { force: true });
