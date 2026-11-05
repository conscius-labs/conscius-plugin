#!/usr/bin/env node
/**
 * Conscius BeforeTool hook for Gemini CLI (CL-2b): the same screen as Claude
 * Code's (../hooks/screen-proposal.mjs) on every conscius_propose call.
 *
 * Gemini CLI passes tool_name and tool_input on stdin and reads
 * {"decision": "deny", "reason"} to block a call (geminicli.com/docs/hooks/
 * reference, checked 2026-10-24). There's no "ask" decision there, so a policy
 * of "ask" refuses and says why.
 */
import { readFileSync } from "node:fs";
import { screenProposal } from "../hooks/screen-proposal.mjs";

let event;
try {
  event = JSON.parse(readFileSync(0, "utf8"));
} catch {}
if (event && /(?:^|_)conscius_propose$/.test(event.tool_name ?? "")) {
  const v = await screenProposal(event, { canAsk: false });
  if (v) process.stdout.write(JSON.stringify({ decision: "deny", reason: v.reason }));
}
