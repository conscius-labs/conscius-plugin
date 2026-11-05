#!/usr/bin/env node
/**
 * Sends the proposals the screen queued (WR-10, brief 38: delayed, batched,
 * anonymous submission). A SessionEnd hook runs it; it starts a detached copy
 * of itself and returns at once, since session-end hooks get a second or two.
 * The copy sends the queue to Conscius's REST API (POST /v1/propose) without
 * a key, in batches of up to 20 claims, then appends what went to the sent
 * log. Whatever fails stays queued for the next session's end.
 *
 *   CONSCIUS_API   the service (default https://mcp.consci.us)
 *   CONSCIUS_QUEUE the queue (default ~/.conscius/queue.jsonl)
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

import { queueFile, sentLog } from "./screen-proposal.mjs";
import { isMain } from "./reminder-core.mjs";

const API = () => (process.env.CONSCIUS_API || "https://mcp.consci.us").replace(/\/$/, "");

/** Sends what's queued; returns { sent, kept }. */
export async function flush({ fetchFn = fetch } = {}) {
  const file = queueFile();
  if (!existsSync(file)) return { sent: 0, kept: 0, waiting: 0 };
  // Take the queue as it is now; proposals queued meanwhile go to a new file.
  const taken = `${file}.${process.pid}.sending`;
  try {
    renameSync(file, taken);
  } catch {
    return { sent: 0, kept: 0, waiting: 0 }; // another flush took it
  }
  const items = readFileSync(taken, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  // Items whose random delay (the policy's submit_delay_hours) hasn't passed wait for a later session's end.
  const now = Date.now();
  const due = items.filter((i) => !i.not_before || Date.parse(i.not_before) <= now);
  for (const i of items.filter((x) => !due.includes(x))) appendFileSync(file, JSON.stringify(i) + "\n");
  const claims = due.flatMap((i) => i.claims ?? []);
  const failed = [];
  let sent = 0;
  for (let i = 0; i < claims.length; i += 20) {
    const batch = claims.slice(i, i + 20);
    try {
      const r = await fetchFn(`${API()}/v1/propose`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "conscius-plugin" }, body: JSON.stringify({ mode: "submit", claims: batch }), signal: AbortSignal.timeout(20_000) });
      if (r.status >= 500 || r.status === 429) throw new Error(String(r.status)); // try again later
      sent += batch.length;
      try {
        const log = sentLog();
        mkdirSync(path.dirname(log), { recursive: true });
        appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), claims: batch, queued: true, status: r.status }) + "\n");
      } catch {}
    } catch {
      failed.push(...batch);
    }
  }
  if (failed.length) appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), claims: failed }) + "\n");
  rmSync(taken, { force: true });
  return { sent, kept: failed.length, waiting: items.length - due.length };
}

async function main() {
  if (process.argv[2] === "--now") {
    await flush();
    return;
  }
  // From the hook: hand the work to a detached process and return.
  if (!existsSync(queueFile())) return;
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, "--now"], { detached: true, stdio: "ignore", env: process.env });
  child.unref();
}

if (isMain(import.meta.url)) await main();
