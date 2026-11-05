#!/usr/bin/env node
/**
 * Conscius Stop hook for Codex CLI (CL-2a): the same end-of-task reminder as
 * Claude Code's, on reminder-core.mjs.
 *
 * Codex's Stop event (learn.chatgpt.com/docs/hooks, checked 2026-10-24) gives
 * session_id, transcript_path, cwd, turn_id, stop_hook_active and
 * last_assistant_message on stdin. Answering {"decision": "block", "reason"}
 * makes Codex continue with the reason as a new prompt; stop_hook_active is
 * true on the stop that follows, so the reminder fires at most once per stop.
 *
 * The transcript is Codex's rollout JSONL. Its docs call the format unstable,
 * so this reads it loosely, from codex-rs/protocol (checked 2026-10-24):
 *   {"type":"response_item","payload":{"type":"function_call","name","namespace"?,"arguments":"<json>","call_id"}}
 *   {"type":"response_item","payload":{"type":"function_call_output","call_id","output": string | [{type:"input_text",text}]}}
 *   {"type":"response_item","payload":{"type":"web_search_call","action":{"type":"search"|"open_page"|…}}}
 *   {"type":"event_msg","payload":{"type":"mcp_tool_call_end","call_id","invocation":{server,tool,arguments},"result":{Ok:{content}}}}
 *   {"type":"response_item","payload":{"type":"custom_tool_call","name":"exec","input":"<javascript>","call_id"}}
 * The last is code mode, the default in Codex 0.164 (seen in a real run,
 * 2026-10-24): the model gets one `exec` tool, writes JavaScript, and calls
 * every other tool inside it, e.g. `await tools.mcp__conscius__conscius_lookup({...})`
 * or `tools.web__run({search_query: [...]})`; the script's output comes back
 * as one custom_tool_call_output. MCP tools are deferred there: the model sees
 * them only by searching ALL_TOOLS.
 * MCP calls are counted once per call_id, from whichever record has them.
 * Web use is Codex's web search, or a shell command that curls or wgets an
 * http(s) URL (how Codex reads a page when web search is off).
 */
import { readFileSync } from "node:fs";
import { loadPolicy } from "../hooks/policy.mjs";
import { consciusTool, log, resultText, isMain, remindFor } from "../hooks/reminder-core.mjs";

const SHELL = /^(shell|exec_command|local_shell|container\.exec|unified_exec)$/;
const FETCH = /\b(curl|wget|http(ie)?)\b[^\n]*https?:\/\//;

const parseArgs = (a) => {
  if (a && typeof a === "object") return a;
  try {
    return JSON.parse(a);
  } catch {
    return {};
  }
};

/** A JavaScript object literal's best guess as JSON ({entity: "x", properties: ['y']}); {} when it isn't simple. */
function literal(src) {
  try {
    return JSON.parse(src);
  } catch {}
  try {
    const json = src
      .replace(/'((?:[^'\\]|\\.)*)'/g, (_, s) => JSON.stringify(s.replace(/\\'/g, "'")))
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/**
 * The tools a code-mode `exec` script calls, in source order: Codex 0.16x
 * gives the model one `exec` tool that runs JavaScript, and every other tool
 * (MCP, web search, shell) is called inside it as tools.<name>(args).
 */
function nestedCalls(src) {
  const out = [];
  for (const m of String(src ?? "").matchAll(/\btools\.([A-Za-z_$][\w$]*)\s*\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    let quote = null;
    for (; i < src.length && depth; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
    }
    const raw = src.slice(start, i - 1).trim();
    out.push({ name: m[1], args: raw.startsWith("{") ? literal(raw) : raw ? { command: raw } : {} });
  }
  return out;
}

/** Codex's rollout JSONL as the shared list of tool calls. */
export function codexCalls(lines) {
  const calls = [];
  const byId = new Map();
  const execGroups = new Map(); // a code-mode exec's call_id -> the Conscius calls inside it
  const add = (id, call) => {
    if (id && byId.has(id)) return byId.get(id);
    calls.push(call);
    if (id) byId.set(id, call);
    return call;
  };
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const p = entry.payload ?? entry.item ?? entry; // older rollouts put the item at the top level
    if (!p || typeof p !== "object") continue;
    switch (p.type) {
      case "custom_tool_call":
        if (p.name === "exec") {
          // Code mode: one script, many tools. Each Conscius call in it gets the script's whole output as its result.
          const group = [];
          for (const n of nestedCalls(p.input)) {
            const tool = consciusTool(n.name);
            if (tool) group.push(add(null, { tool, input: n.args, result: null }));
            else if (/^web__/.test(n.name) || (SHELL.test(n.name) && FETCH.test(JSON.stringify(n.args)))) add(null, { tool: "web", input: n.args, result: null });
          }
          if (p.call_id) execGroups.set(p.call_id, group);
          break;
        }
      // falls through: a custom tool of its own
      case "function_call": {
        const args = parseArgs(p.arguments ?? p.input);
        const tool = consciusTool(p.name); // the names carry "conscius" with or without the mcp__conscius__ namespace
        if (tool) add(p.call_id, { tool, input: args, result: null });
        else if (SHELL.test(p.name ?? "") && FETCH.test(JSON.stringify(args.command ?? args.cmd ?? args))) add(p.call_id, { tool: "web", input: args, result: null });
        else if (/^(web_search|web_fetch|fetch)$/.test(p.name ?? "")) add(p.call_id, { tool: "web", input: args, result: null });
        break;
      }
      case "local_shell_call":
        if (FETCH.test(JSON.stringify(p.action?.command ?? ""))) add(p.call_id, { tool: "web", input: p.action, result: null });
        break;
      case "web_search_call":
      case "web_search_begin":
      case "web_search_end":
        add(p.call_id ?? p.id, { tool: "web", input: p.action ?? { query: p.query }, result: null });
        break;
      case "function_call_output":
      case "custom_tool_call_output":
        if (byId.has(p.call_id) && byId.get(p.call_id).result == null) byId.get(p.call_id).result = resultText(p.output);
        for (const c of execGroups.get(p.call_id) ?? []) c.result ??= resultText(p.output);
        break;
      case "mcp_tool_call_begin":
      case "mcp_tool_call_end": {
        const inv = p.invocation ?? {};
        const tool = /conscius/.test(inv.server ?? "") ? consciusTool(inv.tool) : null;
        if (!tool) break;
        const call = add(p.call_id, { tool, input: parseArgs(inv.arguments), result: null });
        if (p.result != null && call.result == null) call.result = resultText(p.result);
        break;
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
    return;
  }
  if (input.stop_hook_active || !input.transcript_path) return log({ harness: "codex", fired: false, why: input.stop_hook_active ? "already reminded" : "no transcript" });
  const { policy } = loadPolicy(input.cwd || process.cwd());
  if (!policy.remind) return log({ harness: "codex", fired: false, why: policy.write_back === "off" ? "write-back off by policy" : "write-back not turned on (opt-in)" });
  let lines;
  try {
    lines = readFileSync(input.transcript_path, "utf8").split("\n").filter(Boolean);
  } catch {
    return;
  }
  const { fire, reason, ...counts } = remindFor(codexCalls(lines), { policy, sessionId: input.session_id, proposeHint: "the conscius_propose tool" });
  log({ harness: "codex", fired: fire, ...counts });
  // Stop expects JSON on stdout when it exits 0; nothing at all lets Codex stop.
  if (fire) process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

if (isMain(import.meta.url)) main();
