#!/usr/bin/env node
/**
 * Conscius afterMCPExecution and postToolUse hook for Cursor (CL-2c): notes
 * each Conscius and web call for the stop hook (calls.mjs). Prints nothing,
 * so Cursor carries on as before.
 */
import { readFileSync } from "node:fs";
import { isMain } from "../hooks/reminder-core.mjs";
import { record } from "./calls.mjs";

if (isMain(import.meta.url)) {
  try {
    record(JSON.parse(readFileSync(0, "utf8")));
  } catch {} // a hook that fails must never get in the agent's way
}
