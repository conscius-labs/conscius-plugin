/**
 * The Cursor adapter's call log (CL-2c). Cursor's hooks give a transcript
 * path but don't document its format (cursor.com/docs/agent/hooks, checked
 * 2026-10-26), so the adapter keeps its own: afterMCPExecution and
 * postToolUse append each Conscius or web call, normalized as
 * reminder-core.mjs's decide() wants, to a file in the temp folder named by
 * a hash of the conversation ID; the stop hook reads it. It holds what the
 * transcript would (the lookups' words and answers), stays on this machine,
 * and is deleted when the conversation's reminder cap is reached.
 */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { consciusTool, resultText } from "../hooks/reminder-core.mjs";

export const callsFile = (conversationId) => path.join(tmpdir(), `conscius-cursor-${createHash("sha256").update(String(conversationId ?? "")).digest("hex").slice(0, 16)}.jsonl`);

const parse = (s) => {
  if (s && typeof s === "object") return s;
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};
// Web use: a tool named for the web (Cursor doesn't document its web tools' names), or a shell command that fetches a URL
const WEB = /web|search|fetch|brows/i;
const FETCH = /\b(curl|wget|http(ie)?)\b[^\n]*https?:\/\//;

/** A hook event as a normalized call ({ tool, input, result }), or null if it isn't one the reminder counts. */
export function callOf(event) {
  if (event.hook_event_name === "afterMCPExecution" || ("mcp_server_name" in event && "result_json" in event)) {
    const tool = /conscius/i.test(event.mcp_server_name ?? "") ? consciusTool(event.tool_name) ?? consciusTool(`conscius_${event.tool_name}`) : null;
    return tool ? { tool, input: parse(event.tool_input), result: resultText(event.result_json) } : null;
  }
  const name = String(event.tool_name ?? "");
  if (/^MCP:/.test(name)) return null; // counted by afterMCPExecution, which has the result
  if (name === "Shell") return FETCH.test(parse(event.tool_input).command ?? String(event.tool_input ?? "")) ? { tool: "web", input: parse(event.tool_input) } : null;
  if (name === "Grep") return null;
  return WEB.test(name) ? { tool: "web", input: parse(event.tool_input) } : null;
}

export function record(event) {
  const call = callOf(event);
  if (!call || !event.conversation_id) return false;
  appendFileSync(callsFile(event.conversation_id), JSON.stringify(call) + "\n");
  return true;
}

export function readCalls(conversationId) {
  try {
    return readFileSync(callsFile(conversationId), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export const forget = (conversationId) => rmSync(callsFile(conversationId), { force: true });
