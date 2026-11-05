#!/usr/bin/env node
/**
 * Conscius Stop hook for Claude Code: the end-of-task "reflect" step from brief 08.
 *
 * Claude Code runs this when the agent is about to finish. It reads the
 * session transcript, turns it into the shared list of tool calls and asks
 * reminder-core.mjs whether to ask the agent to keep going for one more step.
 * It does nothing when this stop is already the result of this hook
 * (stop_hook_active), so ordinary sessions finish as usual.
 */
import { readFileSync } from "node:fs";
import { loadPolicy } from "./policy.mjs";
import { consciusTool, log, isMain, remindFor } from "./reminder-core.mjs";

const WEB = /^(WebSearch|WebFetch)$/;
// A server added with `claude mcp add` is mcp__conscius__…; the plugin's own is mcp__plugin_conscius_conscius__….
const CONSCIUS_SERVER = /^mcp__(?:plugin_conscius_)?conscius__/;

/** Claude Code's transcript JSONL as the shared list of tool calls. */
export function claudeCalls(lines) {
  const calls = [];
  const byId = new Map();
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_use") {
        const tool = CONSCIUS_SERVER.test(block.name) ? consciusTool(block.name) : WEB.test(block.name) ? "web" : null;
        if (!tool) continue;
        const call = { tool, input: block.input, result: null };
        calls.push(call);
        byId.set(block.id, call);
      }
      if (block.type === "tool_result" && byId.has(block.tool_use_id)) {
        byId.get(block.tool_use_id).result = Array.isArray(block.content) ? block.content.map((c) => c.text ?? "").join("") : String(block.content ?? "");
      }
    }
  }
  return calls;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return; // nothing to go on: let the agent stop
  }
  if (input.stop_hook_active || !input.transcript_path) return log({ fired: false, why: input.stop_hook_active ? "already reminded" : "no transcript" });
  const { policy } = loadPolicy(input.cwd || process.cwd());
  if (!policy.remind) return log({ fired: false, why: policy.write_back === "off" ? "write-back off by policy" : "write-back not turned on (opt-in)" });

  let lines;
  try {
    lines = readFileSync(input.transcript_path, "utf8").split("\n").filter(Boolean);
  } catch {
    return;
  }
  const { fire, reason, ...counts } = remindFor(claudeCalls(lines), { policy, sessionId: input.session_id });
  log({ fired: fire, ...counts });
  if (fire) process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

if (isMain(import.meta.url)) main();
