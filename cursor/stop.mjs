#!/usr/bin/env node
/**
 * Conscius stop hook for Cursor (CL-2c): the same end-of-task reminder as
 * Claude Code's, on reminder-core.mjs.
 *
 * Cursor's stop event (cursor.com/docs/agent/hooks, checked 2026-10-26)
 * gives conversation_id, status ("completed", "aborted" or "error"),
 * loop_count (follow-ups already triggered) and workspace_roots on stdin.
 * Printing {"followup_message": "…"} makes Cursor send it as the next user
 * message; hooks.json's loop_limit caps how often, and this hook answers only
 * when loop_count is 0, so it never follows up on its own follow-up.
 * The calls come from record.mjs's log, not the transcript, whose format
 * Cursor doesn't document.
 */
import { readFileSync } from "node:fs";
import { loadPolicy } from "../hooks/policy.mjs";
import { isMain, log, remindFor } from "../hooks/reminder-core.mjs";
import { forget, readCalls } from "./calls.mjs";

export function stopAnswer(input, { policy } = {}) {
  if (input.status && input.status !== "completed") return { why: `stopped (${input.status})` };
  if (input.loop_count > 0) return { why: "already reminded" };
  if (!policy.remind) return { why: policy.write_back === "off" ? "write-back off by policy" : "write-back not turned on (opt-in)" };
  const { fire, reason, ...counts } = remindFor(readCalls(input.conversation_id), { policy, sessionId: input.conversation_id, proposeHint: "the conscius_propose tool" });
  if (counts.why?.startsWith("cap reached")) forget(input.conversation_id);
  return fire ? { followup_message: reason, counts } : { counts };
}

if (isMain(import.meta.url)) {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const { policy } = loadPolicy(input.workspace_roots?.[0] || process.cwd());
  const a = stopAnswer(input, { policy });
  log({ harness: "cursor", fired: Boolean(a.followup_message), ...(a.why ? { why: a.why } : a.counts) });
  if (a.followup_message) process.stdout.write(JSON.stringify({ followup_message: a.followup_message }));
}
