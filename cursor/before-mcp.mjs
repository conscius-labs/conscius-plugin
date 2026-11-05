#!/usr/bin/env node
/**
 * Conscius beforeMCPExecution hook for Cursor (CL-2c): the same screen as
 * Claude Code's (../hooks/screen-proposal.mjs) on every conscius_propose.
 *
 * Cursor's beforeMCPExecution (cursor.com/docs/agent/hooks, checked
 * 2026-10-26) gives tool_name, tool_input (a JSON string), mcp_server_name
 * and workspace_roots, and reads {"permission": "allow" | "deny" | "ask",
 * "user_message", "agent_message"}. Invalid output blocks the call, so this
 * always answers, and allows everything that isn't a Conscius proposal.
 */
import { readFileSync } from "node:fs";
import { isMain } from "../hooks/reminder-core.mjs";
import { screenProposal } from "../hooks/screen-proposal.mjs";

export async function beforeMcpAnswer(event) {
  const propose = /conscius/i.test(event.mcp_server_name ?? "") && /(^|_)(conscius_)?propose$/.test(event.tool_name ?? "");
  if (!propose) return { permission: "allow" };
  let input = event.tool_input;
  try {
    if (typeof input === "string") input = JSON.parse(input);
  } catch {
    input = {};
  }
  const v = await screenProposal({ ...event, tool_input: input, cwd: event.workspace_roots?.[0] ?? event.cwd, session_id: event.conversation_id }, { canAsk: true });
  if (!v) return { permission: "allow" };
  return { permission: v.decision, ...(v.decision === "deny" ? { agent_message: v.reason } : {}), user_message: v.reason };
}

if (isMain(import.meta.url)) {
  let event = {};
  try {
    event = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  process.stdout.write(JSON.stringify(await beforeMcpAnswer(event)));
}
