/**
 * The write-back policy (CL-3, brief 30): what may leave this machine as a
 * Conscius proposal. Read by the PreToolUse screen and the Stop reminder.
 *
 * Found in, first match wins:
 *   1. the managed file a company pushes, which users can't override:
 *      /Library/Application Support/Conscius/policy.json (macOS),
 *      /etc/conscius/policy.json (Linux), %ProgramData%\Conscius\policy.json (Windows);
 *      CONSCIUS_MANAGED_POLICY names another path (tests, MDM layouts);
 *   2. CONSCIUS_POLICY;
 *   3. the project's .conscius/policy.json;
 *   4. ~/.conscius/policy.json.
 *
 *   {
 *     "write_back": "on" | "ask" | "off",      ask: the user approves each proposal
 *     "allow_source_domains": ["python.org"],  if set, only these (and their subdomains)
 *     "block_source_domains": ["corp.example.com"],
 *     "block_terms": ["Project Falcon"],        whole words, any field
 *     "allow_properties": ["latest version"],   if set, only these property words
 *     "remind_for": "unsettled" | "missing" | "wanted",
 *     "max_reminders": 3,                      end-of-task reminders per session (CL-7); 0: none
 *     "submit": "now" | "queued",              queued: sent after the session, anonymously (WR-10)
 *     "submit_delay_hours": 0,                 queued ones wait a random time up to this, at most a week
 *     "public_terms": ["Acme Corp"],           CL-16: names that are public (the company, a public repository): never screened
 *     "collisions": "block" | "ask" | "allow"  CL-16: a short identity term matched in context (ask by default; where
 *   }                                          the tool can't ask, block; allow keeps a local audit record)
 *
 * remind_for (CL-6) narrows what the end-of-task reminder asks for: unsettled
 * (the default: missing, unconfirmed, disputed or stale), missing (facts or
 * things Conscius didn't have), or wanted (missing facts that other agents
 * also looked for: the wanted list).
 *
 * The end-of-task reminder is opt-in (brief 22): it runs only when a policy
 * file sets write_back to "on" or "ask", or CONSCIUS_WRITE_BACK=1 is set, and
 * never when write_back is "off". Without either, agents can still propose on
 * their own, and the screen still applies.
 *
 * A domain matches itself and its subdomains; "*.example.com" only its
 * subdomains. A file that can't be read or parsed fails closed: write-back off.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const MODES = ["on", "ask", "off"];

export function managedPath(env = process.env, platform = process.platform) {
  if (env.CONSCIUS_MANAGED_POLICY) return env.CONSCIUS_MANAGED_POLICY;
  if (platform === "darwin") return "/Library/Application Support/Conscius/policy.json";
  if (platform === "win32") return path.join(env.ProgramData || "C:\\ProgramData", "Conscius", "policy.json");
  return "/etc/conscius/policy.json";
}

/** The policy in force and the file it came from (null: none, so the defaults). */
export function loadPolicy(cwd = process.cwd(), env = process.env) {
  const candidates = [managedPath(env), env.CONSCIUS_POLICY, path.join(cwd, ".conscius", "policy.json"), path.join(homedir(), ".conscius", "policy.json")];
  for (const file of candidates) {
    if (!file || !existsSync(file)) continue;
    try {
      return { policy: normalize(JSON.parse(readFileSync(file, "utf8")), env), from: file, managed: file === candidates[0] };
    } catch {
      return { policy: { ...normalize({}, env), write_back: "off", remind: false }, from: file, managed: file === candidates[0], broken: true };
    }
  }
  return { policy: normalize({}, env), from: null, managed: false };
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const list = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : []);

function normalize(p, env = {}) {
  const write_back = MODES.includes(p.write_back) ? p.write_back : "on";
  return {
    write_back,
    remind: write_back !== "off" && (p.write_back === "on" || p.write_back === "ask" || env.CONSCIUS_WRITE_BACK === "1"),
    allow_source_domains: list(p.allow_source_domains),
    block_source_domains: list(p.block_source_domains),
    block_terms: Array.isArray(p.block_terms) ? p.block_terms.map(String).filter((t) => t.trim().length >= 3) : [],
    allow_properties: list(p.allow_properties).map(norm),
    remind_for: ["unsettled", "missing", "wanted"].includes(p.remind_for) ? p.remind_for : "unsettled",
    // CL-7: at most this many end-of-task reminders in one session (default 3).
    max_reminders: Number.isInteger(p.max_reminders) && p.max_reminders >= 0 ? p.max_reminders : 3,
    // WR-10: "queued" keeps screened proposals on this machine and sends them after the session, without a key.
    submit: p.submit === "queued" ? "queued" : "now",
    // WR-10: a queued proposal waits a random time up to this many hours before it may be sent (0: at the session's end).
    submit_delay_hours: Number.isFinite(p.submit_delay_hours) && p.submit_delay_hours > 0 ? Math.min(p.submit_delay_hours, 168) : 0,
    // CL-16: public entities the screen must not take for the user's own, and what to do with a possible collision
    public_terms: Array.isArray(p.public_terms) ? p.public_terms.map(String).filter((t) => t.trim().length >= 3) : [],
    collisions: ["block", "ask", "allow"].includes(p.collisions) ? p.collisions : "ask",
  };
}

/** Does `host` fall under one of `patterns`? */
export function domainIn(host, patterns) {
  const h = String(host ?? "").toLowerCase().replace(/\.$/, "");
  return patterns.some((p) => (p.startsWith("*.") ? h.endsWith(p.slice(1)) : h === p || h.endsWith("." + p)));
}

/** What the policy says about these claims: problems that block them, as short kinds (never the text). */
export function policyProblems(claims, policy) {
  const problems = new Set();
  for (const c of claims) {
    let host = "";
    try {
      host = new URL(c?.source_url).hostname;
    } catch {}
    if (policy.allow_source_domains.length && !domainIn(host, policy.allow_source_domains)) problems.add("its source isn't on your policy's list of allowed domains");
    if (domainIn(host, policy.block_source_domains)) problems.add("its source is on a domain your policy blocks");
    if (policy.allow_properties.length && !policy.allow_properties.includes(norm(c?.property))) problems.add("its property isn't one your policy allows sharing");
    for (const t of policy.block_terms) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu");
      if (Object.values(c ?? {}).some((v) => re.test(typeof v === "string" ? v : JSON.stringify(v ?? "")))) problems.add("it contains a term your policy blocks");
    }
  }
  return [...problems];
}
