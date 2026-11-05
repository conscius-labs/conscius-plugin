#!/usr/bin/env node
/**
 * Conscius agentStop hook for GitHub Copilot (CL-8): the same end-of-task
 * reminder as Claude Code's, on reminder-core.mjs.
 *
 * Copilot's agentStop (docs.github.com copilot/reference/hooks-configuration,
 * checked 2026-10-31; Copilot CLI and the cloud agent) gives sessionId, cwd,
 * transcriptPath, stopReason and stop_hook_active on stdin (snake_case under
 * VS Code's "Stop" name). Printing {"decision": "block", "reason": "…"}
 * forces another turn with `reason` as its prompt; stop_hook_active is true
 * on a turn this hook forced, so it never follows up its own follow-up. The
 * calls come from record.mjs's log, since the transcript isn't documented.
 * Brief 28 had found no continuation hook for Copilot; agentStop is newer.
 */
import { readFileSync } from "node:fs";
import { loadPolicy } from "../hooks/policy.mjs";
import { isMain, log, remindFor } from "../hooks/reminder-core.mjs";
import { forget, readCalls } from "./calls.mjs";

export function stopAnswer(input, { policy } = {}) {
  const sessionId = input.sessionId ?? input.session_id;
  if (input.stop_hook_active) return { why: "already reminded" };
  if (!policy.remind) return { why: policy.write_back === "off" ? "write-back off by policy" : "write-back not turned on (opt-in)" };
  const { fire, reason, ...counts } = remindFor(readCalls(sessionId), { policy, sessionId, proposeHint: "the conscius_propose tool" });
  if (counts.why?.startsWith("cap reached")) forget(sessionId);
  return fire ? { decision: "block", reason, counts } : { counts };
}

if (isMain(import.meta.url)) {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const { policy } = loadPolicy(input.cwd || process.cwd());
  const a = stopAnswer(input, { policy });
  log({ harness: "copilot", fired: a.decision === "block", ...(a.why ? { why: a.why } : a.counts) });
  if (a.decision === "block") process.stdout.write(JSON.stringify({ decision: "block", reason: a.reason }));
}
