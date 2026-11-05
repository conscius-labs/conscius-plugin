#!/usr/bin/env node
/**
 * Conscius PreToolUse hook for Codex CLI (CL-2a): the same screen as Claude
 * Code's (../hooks/screen-proposal.mjs) on every conscius_propose call.
 *
 * Codex's PreToolUse covers MCP tools, names them like Claude Code
 * (mcp__conscius__conscius_propose), passes the arguments as tool_input and
 * reads the same hookSpecificOutput.permissionDecision "deny" answer
 * (learn.chatgpt.com/docs/hooks, checked 2026-10-24). Codex parses "ask" but
 * doesn't support it yet: the hook counts as failed and the call goes ahead.
 * So a policy of "ask" refuses here and says why.
 */
import { runPreToolUse } from "../hooks/screen-proposal.mjs";

await runPreToolUse((name) => /^mcp__conscius__conscius_propose$/.test(name), { canAsk: false });
