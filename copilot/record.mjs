#!/usr/bin/env node
/**
 * Conscius postToolUse hook for GitHub Copilot (CL-8): notes each Conscius
 * and web call for the agentStop hook (calls.mjs). Prints nothing, so
 * Copilot carries on as before.
 */
import { readFileSync } from "node:fs";
import { isMain } from "../hooks/reminder-core.mjs";
import { record } from "./calls.mjs";

if (isMain(import.meta.url)) {
  try {
    record(JSON.parse(readFileSync(0, "utf8")));
  } catch {} // a hook that fails must never get in the agent's way
}
