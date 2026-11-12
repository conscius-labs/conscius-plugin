#!/usr/bin/env node
/**
 * Adds the Conscius hooks (and the MCP server, for Gemini CLI) to Codex CLI or
 * Gemini CLI, with this folder's absolute paths (CL-2a, CL-2b). Claude Code
 * installs the plugin itself and doesn't need this.
 *
 *   node plugin/install.mjs codex [--write] [--no-skill] [--instructions]   ~/.codex/hooks.json
 *   node plugin/install.mjs gemini [--write] [--instructions]             ~/.gemini/settings.json
 *   node plugin/install.mjs cursor [--write]                              ~/.cursor/hooks.json
 *   node plugin/install.mjs copilot [--write]                             ~/.copilot/hooks/conscius.json (Copilot CLI)
 *   node plugin/install.mjs opencode [--write]                            ~/.config/opencode/opencode.json (OpenCode V2)
 *
 * Codex 0.164 defers MCP tools (the model sees them only by searching
 * ALL_TOOLS), and in smoke runs without help GPT-6.1 Sol never found Conscius
 * (0 of 3 runs). Either of these fixed it (brief 28):
 *   the skill       copied to ~/.codex/skills/conscius by default (2 of 2 looked up; --no-skill leaves it out);
 *   --instructions  adds one line to ~/.codex/AGENTS.md (or ~/.gemini/GEMINI.md)
 *                   asking the agent to look facts up first (5 of 5).
 * Gemini CLI lists MCP tools up front and looked up first in 9 of 9 runs without either.
 *
 * Both also get /conscius:contribute (CL-9), from commands/contribute.md:
 * Gemini as a custom command (~/.gemini/commands/conscius/contribute.toml),
 * Codex as a skill (~/.codex/skills/conscius-contribute/, with the skill),
 * since Codex has deprecated custom prompts for skills.
 *
 * Without --write it prints the merged file. Earlier Conscius entries are
 * replaced, everything else is kept. CODEX_HOME (or HOME) moves the targets.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isMain } from "./hooks/reminder-core.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MCP_URL = "https://mcp.consci.us/mcp";
/** The line --instructions adds. Codex's names where to find deferred tools; Gemini lists MCP tools up front. */
export const INSTRUCTION = {
  codex: "Before you search the web for a specific fact (a version, date, number, price, or who holds a role), look it up with the conscius_lookup tool first. Find it in ALL_TOOLS if it isn't listed.",
  gemini: "Before you search the web for a specific fact (a version, date, number, price, or who holds a role), look it up with the conscius_lookup tool first.",
};
const cmd = (file) => `node ${JSON.stringify(path.join(HERE, file))}`;
// This folder, wherever it was cloned, or an earlier install's path.
const ours = (group) => (group.hooks ?? []).some((h) => (h.command ?? "").includes(HERE) || /conscius|[\\/]plugin[\\/](codex|gemini)[\\/]/.test(h.command ?? ""));
const oursCursor = (h) => (h.command ?? "").includes(HERE) || /conscius|[\\/]plugin[\\/]cursor[\\/]/.test(h.command ?? "");
// The skill: beside this file in the public repo, one level up in the source repo.
const SKILL_DIR = [path.join(HERE, "skill", "conscius"), path.join(HERE, "..", "skill", "conscius")].find((d) => existsSync(d));

/** Adds `groups` to each event in `hooks`, after dropping earlier Conscius groups. */
function merge(hooks = {}, groups) {
  const out = { ...hooks };
  for (const [event, list] of Object.entries(groups)) out[event] = [...(out[event] ?? []).filter((g) => !ours(g)), ...list];
  return out;
}

/** Codex's hooks.json (the same shape as Claude Code's). */
export function codexConfig(existing = {}) {
  return {
    ...existing,
    hooks: merge(existing.hooks, {
      Stop: [{ hooks: [{ type: "command", command: cmd("codex/stop.mjs"), timeout: 10 }] }],
      PreToolUse: [{ matcher: "^mcp__conscius__conscius_propose$", hooks: [{ type: "command", command: cmd("codex/pre-tool-use.mjs"), timeout: 10 }] }],
      SessionEnd: [{ hooks: [{ type: "command", command: cmd("hooks/flush-queue.mjs"), timeout: 2 }] }], // WR-10: queued proposals
    }),
  };
}

/**
 * Cursor's hooks.json (CL-2c, cursor.com/docs/agent/hooks, checked 2026-10-26): version 1, each event a
 * list of { command }. The stop hook's loop_limit of 1 is a second guard beside its own loop_count check.
 * Built from Cursor's docs; not yet run in a real Cursor.
 */
export function cursorConfig(existing = {}) {
  const hooks = { ...(existing.hooks ?? {}) };
  const add = { stop: [{ command: cmd("cursor/stop.mjs"), loop_limit: 1 }], afterMCPExecution: [{ command: cmd("cursor/record.mjs") }], postToolUse: [{ command: cmd("cursor/record.mjs") }], beforeMCPExecution: [{ command: cmd("cursor/before-mcp.mjs") }] };
  for (const [event, list] of Object.entries(add)) hooks[event] = [...(hooks[event] ?? []).filter((h) => !oursCursor(h)), ...list];
  return { ...existing, version: existing.version ?? 1, hooks };
}

/**
 * GitHub Copilot's hooks file (CL-8, docs.github.com copilot/reference/hooks-configuration, checked 2026-10-31):
 * version 1, each event a list of { type: "command", bash, powershell, timeoutSec }. A file of its own, so it's
 * replaced whole. The CLI reads it from ~/.copilot/hooks/ ($COPILOT_HOME/hooks/); the cloud agent reads only the
 * repository's .github/hooks/, so it would need these scripts in the repository. Built from the docs; not yet run.
 */
export function copilotConfig() {
  const entry = (file, timeoutSec) => ({ type: "command", bash: cmd(file), powershell: cmd(file), timeoutSec });
  return {
    version: 1,
    hooks: {
      agentStop: [entry("copilot/stop.mjs", 10)],
      postToolUse: [entry("copilot/record.mjs", 5)],
      preToolUse: [entry("copilot/pre-tool.mjs", 10)],
      sessionEnd: [entry("hooks/flush-queue.mjs", 2)], // WR-10: queued proposals
    },
  };
}

/**
 * OpenCode V2's opencode.json (CL-2): the MCP server and this folder's opencode/ plugin, a directory whose
 * package.json exports ./server (opencode.ai/v2/docs/build/plugins, checked 2026-10-31). OpenCode names the
 * server's tools conscius_conscius_lookup and so on. Code Mode is off for Conscius (codemode: false, V2's default is
 * on), so its tools are called directly, where the plugin's tool hooks see them. Earlier Conscius entries in
 * `plugins` are replaced.
 */
export function opencodeConfig(existing = {}) {
  const dir = path.join(HERE, "opencode");
  const isOurs = (p) => p === dir || /[\\/]plugin[\\/]opencode[\\/]?$|conscius-opencode/.test(typeof p === "string" ? p : p?.package ?? "");
  return {
    ...existing,
    mcp: { ...existing.mcp, servers: { ...existing.mcp?.servers, conscius: { type: "remote", url: MCP_URL, codemode: false, ...existing.mcp?.servers?.conscius } } },
    plugins: [...(existing.plugins ?? []).filter((p) => !isOurs(p)), dir],
  };
}

/** Gemini CLI's settings.json: the MCP server and the hooks (timeouts in milliseconds). */
export function geminiConfig(existing = {}) {
  return {
    ...existing,
    // A conscius entry already there is left as it is: `gemini mcp add` writes `url` and `type`, and an added `httpUrl`
    // would win over them, moving a signed-in /mcp/account entry back to the anonymous address.
    mcpServers: { ...existing.mcpServers, conscius: existing.mcpServers?.conscius ?? { httpUrl: MCP_URL } },
    hooks: merge(existing.hooks, {
      AfterAgent: [{ hooks: [{ type: "command", name: "conscius-reminder", command: cmd("gemini/after-agent.mjs"), timeout: 10000 }] }],
      BeforeTool: [{ matcher: "conscius_propose$", hooks: [{ type: "command", name: "conscius-screen", command: cmd("gemini/before-tool.mjs"), timeout: 10000 }] }],
      SessionEnd: [{ hooks: [{ type: "command", name: "conscius-queue", command: cmd("hooks/flush-queue.mjs"), timeout: 2000 }] }], // WR-10: queued proposals
    }),
  };
}

/** commands/contribute.md, as its frontmatter fields and its body. */
export function contributeCommand() {
  const text = readFileSync(path.join(HERE, "commands", "contribute.md"), "utf8");
  const [, front, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  const field = (k) => new RegExp(`^${k}:\\s*"?(.*?)"?$`, "m").exec(front)?.[1] ?? "";
  return { description: field("description"), body: body.trim() };
}

/** The command as a Gemini CLI custom command (TOML; {{args}} for what the user typed). */
export function geminiCommand() {
  const { description, body } = contributeCommand();
  const prompt = body.replaceAll("$ARGUMENTS", "{{args}}");
  return `# Installed by plugin/install.mjs from plugin/commands/contribute.md (CL-9).\ndescription = ${JSON.stringify(description)}\nprompt = """\n${prompt.replaceAll('"""', '\\"\\"\\"')}\n"""\n`;
}

/** The command as a Codex skill: Codex reads skills, and has deprecated custom prompts. */
export function codexContributeSkill() {
  const { description, body } = contributeCommand();
  return `---\nname: conscius-contribute\ndescription: ${description}. Use when the user asks to contribute to Conscius or fill its gaps.\n---\n\n${body.replace("The user asked: $ARGUMENTS", "Use what the user asked for (how many, a topic), if anything.")}\n`;
}

function main() {
  const [harness, ...flags] = process.argv.slice(2);
  const flag = flags.includes("--write") ? "--write" : null;
  const targets = {
    codex: [path.join(process.env.CODEX_HOME || path.join(homedir(), ".codex"), "hooks.json"), codexConfig, "AGENTS.md"],
    gemini: [path.join(homedir(), ".gemini", "settings.json"), geminiConfig, "GEMINI.md"],
    cursor: [path.join(homedir(), ".cursor", "hooks.json"), cursorConfig, null],
    copilot: [path.join(process.env.COPILOT_HOME || path.join(homedir(), ".copilot"), "hooks", "conscius.json"), copilotConfig, null],
    opencode: [path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "opencode", "opencode.json"), opencodeConfig, null],
  };
  if (!targets[harness]) {
    console.error("usage: node install.mjs codex|gemini|cursor|copilot|opencode [--write] [--no-skill] [--instructions]");
    process.exit(2);
  }
  const [file, build, notes] = targets[harness];
  if (harness === "opencode" && existsSync(file + "c")) {
    // opencode.jsonc may hold comments this script would drop: say what to add instead of rewriting it.
    console.error(`${file}c exists; add this to it by hand:\n${JSON.stringify(opencodeConfig({}), null, 2)}`);
    process.exit(1);
  }
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const text = JSON.stringify(build(existing), null, 2) + "\n";
  if (flag !== "--write") return process.stdout.write(text);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`wrote ${file}`);
  // The skill ships with Codex by default; the AGENTS.md line can go alongside it.
  if (harness === "codex" && !flags.includes("--no-skill")) {
    const to = path.join(path.dirname(file), "skills", "conscius");
    cpSync(SKILL_DIR, to, { recursive: true });
    const contribute = path.join(path.dirname(file), "skills", "conscius-contribute");
    mkdirSync(contribute, { recursive: true });
    writeFileSync(path.join(contribute, "SKILL.md"), codexContributeSkill());
    console.log(`copied the Conscius skill to ${to}, and the contribute skill to ${contribute}`);
  }
  if (harness === "gemini") {
    const to = path.join(path.dirname(file), "commands", "conscius", "contribute.toml");
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, geminiCommand());
    console.log(`added /conscius:contribute at ${to}`);
  }
  if (flags.includes("--instructions") && notes) {
    const md = path.join(path.dirname(file), notes);
    const have = existsSync(md) ? readFileSync(md, "utf8") : "";
    if (!have.includes("conscius_lookup")) writeFileSync(md, (have && !have.endsWith("\n") ? have + "\n" : have) + INSTRUCTION[harness] + "\n");
    console.log(`added the Conscius line to ${md}`);
  }
  if (harness === "codex") {
    console.log(`\nAdd the server to ~/.codex/config.toml if it isn't there:\n\n[mcp_servers.conscius]\nurl = "${MCP_URL}"\n\nCodex asks you before each proposal (conscius_propose writes); approve it, or set default_tools_approval_mode = "approve" under it.\n`);
    console.log("Then open Codex and trust the new hooks with /hooks (Codex skips hooks it hasn't been told to trust).");
  }
}

if (isMain(import.meta.url)) main();
