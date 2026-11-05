#!/usr/bin/env node
/**
 * Conscius preToolUse hook for GitHub Copilot (CL-8): the same screen as
 * Claude Code's (../hooks/screen-proposal.mjs) on every conscius_propose.
 *
 * Copilot's preToolUse gives sessionId, cwd, toolName and toolArgs (a JSON
 * string) and reads {"permissionDecision": "allow" | "deny" | "ask",
 * "permissionDecisionReason"} (the reason is required with deny, and shown to
 * the agent). Under the cloud agent "ask" counts as deny, which is the safe
 * side for a flagged proposal. Command hooks fail closed on a crash, so this
 * always answers, and allows everything that isn't a Conscius proposal.
 */
import { readFileSync } from "node:fs";
import { consciusTool, isMain } from "../hooks/reminder-core.mjs";
import { screenProposal } from "../hooks/screen-proposal.mjs";

export async function preToolAnswer(event) {
  const name = String(event.toolName ?? event.tool_name ?? "");
  if (consciusTool(name) !== "propose") return { permissionDecision: "allow" };
  let input = event.toolArgs ?? event.tool_input;
  try {
    if (typeof input === "string") input = JSON.parse(input);
  } catch {
    input = {};
  }
  const v = await screenProposal({ ...event, tool_name: name, tool_input: input ?? {}, cwd: event.cwd, session_id: event.sessionId ?? event.session_id }, { canAsk: true }).catch(() => null);
  if (!v) return { permissionDecision: "allow" };
  return { permissionDecision: v.decision, permissionDecisionReason: v.reason };
}

if (isMain(import.meta.url)) {
  let event = {};
  try {
    event = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  process.stdout.write(JSON.stringify(await preToolAnswer(event).catch(() => ({ permissionDecision: "allow" }))));
}
