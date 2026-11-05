#!/usr/bin/env node
/**
 * Conscius AfterAgent hook for Gemini CLI (CL-2b): the same end-of-task
 * reminder as Claude Code's, on reminder-core.mjs.
 *
 * Gemini CLI's AfterAgent event (geminicli.com/docs/hooks/reference, checked
 * 2026-10-24) gives session_id, transcript_path, cwd, prompt,
 * prompt_response and stop_hook_active on stdin. Answering
 * {"decision": "deny", "reason"} rejects the agent's final answer and sends
 * the reason back as a new prompt, so the agent continues.
 *
 * Loop guard: a marker file per session and prompt in the temp folder, so the
 * reminder fires at most once per user prompt. The docs list
 * stop_hook_active, but in a real run (Gemini CLI 0.65, 2026-10-24) the retry
 * came without it, and the marker is what stopped a second reminder.
 *
 * The transcript is Gemini CLI's chat record (packages/core/src/services/
 * chatRecordingTypes.ts, checked 2026-10-24): JSONL whose lines are a
 * metadata record, message records ({id, type: "gemini", toolCalls: [{id,
 * name, args, result, status}]}), {"$patch": {...}} updates, {"$set": {...}}
 * and {"$rewindTo": id}; older sessions are one JSON object with messages.
 * Tool results are Gemini's function-response parts. MCP tools appear as
 * conscius_lookup, or mcp_conscius_conscius_lookup and conscius__conscius_lookup
 * when names clash; the web tools are google_web_search and web_fetch.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadPolicy } from "../hooks/policy.mjs";
import { consciusTool, log, resultText, isMain, remindFor } from "../hooks/reminder-core.mjs";

const WEB = /^(google_web_search|web_fetch|web_search)$/;

/** Gemini CLI's chat record (JSONL, or the older single JSON) as the shared list of tool calls. */
export function geminiCalls(text) {
  const messages = new Map(); // id -> message, in first-seen order
  const order = [];
  const put = (m) => {
    if (!m?.id) return;
    if (!messages.has(m.id)) order.push(m.id);
    messages.set(m.id, { ...messages.get(m.id), ...m });
  };
  const patch = (p) => {
    if (!p) return;
    if (p.id) {
      const m = messages.get(p.id);
      if (m) {
        if (p.content !== undefined) m.content = p.content;
        for (const tp of p.toolCalls ?? []) {
          const tc = (m.toolCalls ?? []).find((t) => t.id === tp.id);
          if (tc) Object.assign(tc, tp);
          else (m.toolCalls ??= []).push(tp);
        }
      }
    }
    for (const u of p.updates ?? []) patch(u);
    for (const id of p.removeIds ?? []) messages.delete(id);
  };
  let records;
  try {
    records = [JSON.parse(text)]; // the older single-file form
  } catch {
    records = text.split("\n").filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  }
  for (const r of records) {
    if (Array.isArray(r.messages)) r.messages.forEach(put);
    if (Array.isArray(r.$set?.messages)) r.$set.messages.forEach(put);
    if (r.$patch) patch(r.$patch);
    if (r.$rewindTo) {
      // Everything after the rewound-to message is gone.
      const at = order.indexOf(r.$rewindTo);
      if (at >= 0) for (const id of order.splice(at + 1)) messages.delete(id);
    }
    if (r.id && r.type) put(r);
  }
  const calls = [];
  for (const id of order) {
    const m = messages.get(id);
    if (!m) continue;
    for (const tc of m.toolCalls ?? []) {
      const tool = consciusTool(tc.name) ?? (WEB.test(tc.name ?? "") ? "web" : null);
      if (tool) calls.push({ tool, input: tc.args ?? {}, result: tc.result == null ? null : resultText(tc.result) });
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
  if (input.stop_hook_active || !input.transcript_path) return log({ harness: "gemini", fired: false, why: input.stop_hook_active ? "already reminded" : "no transcript" });
  const marker = path.join(tmpdir(), `conscius-gemini-${createHash("sha256").update(`${input.session_id ?? ""}\n${input.prompt ?? ""}`).digest("hex").slice(0, 16)}`);
  if (existsSync(marker)) return log({ harness: "gemini", fired: false, why: "already reminded (marker)" });
  const { policy } = loadPolicy(input.cwd || process.cwd());
  if (!policy.remind) return log({ harness: "gemini", fired: false, why: policy.write_back === "off" ? "write-back off by policy" : "write-back not turned on (opt-in)" });
  let text;
  try {
    text = readFileSync(input.transcript_path, "utf8");
  } catch {
    return;
  }
  const { fire, reason, ...counts } = remindFor(geminiCalls(text), { policy, sessionId: input.session_id, proposeHint: "the conscius_propose tool" });
  log({ harness: "gemini", fired: fire, ...counts });
  if (!fire) return;
  try {
    writeFileSync(marker, new Date().toISOString());
  } catch {} // without the marker, stop_hook_active still guards
  process.stdout.write(JSON.stringify({ decision: "deny", reason }));
}

if (isMain(import.meta.url)) main();
