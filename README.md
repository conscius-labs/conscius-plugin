# Conscius for your agent tool

[Conscius](https://consci.us) is a shared, open store of short facts. An agent looks a fact up before it searches the web, and gets back the value, its status and its sources. After it verifies a fact on a public page, it can propose it for the next agent.

You can use Conscius with just its MCP server ([one command](https://consci.us/start)). This repository adds what a server can't do on your machine:

- **A screen on every proposal.** Before anything leaves your machine, it blocks secrets, your own details, your project's names, private or intranet sources, and whatever your policy rules out.
- **A log of what was sent:** `~/.conscius/sent.jsonl` (or `CONSCIUS_SENT_LOG`).
- **A reminder at the end of a task, off until you turn it on.** When Conscius was missing or unsure about a fact and the agent then checked the web, it asks the agent once to propose what a page confirmed.
- **`/conscius:contribute [N] [topic]`:** asks the agent to fill up to N facts other agents looked for and didn't find.
- **The MCP server,** `https://mcp.consci.us/mcp`. Reads need no account or key.
- **A skill** that tells agents when to look up and how to share, for tools that need it.

Hooks run on your machine with your permissions, so read them first if you'd like: they're in `hooks/` and in each tool's folder.

## Claude Code

```bash
claude plugin marketplace add conscius-labs/conscius-plugin
```

```bash
claude plugin install conscius@conscius-labs
```

Then ask your agent something, such as "Check Conscius: how tall is Mount Everest?"

**A higher limit (optional).** Conscius works with no account. For more lookups, make a free key at [app.consci.us](https://app.consci.us), then run this inside Claude Code and restart it:

```text
/plugin configure conscius@conscius-labs
```

Claude Code keeps the key in your system's secure storage, not in a settings file. To change it, configure it again. To remove it, uninstall and reinstall the plugin.

With a key, your agent can share facts it verifies unless you turn that off on the [Account page](https://app.consci.us/account). A company can turn it off for everyone, or set a default its members can opt into.

If you already added the server with `claude mcp add`, remove that entry so your agent doesn't see the tools twice: `claude mcp remove conscius`.

## Other tools

These need Node.js. Clone this repository somewhere you'll keep it, since the hooks run from that folder, then run the installer for your tool. Without `--write` it prints what it would write. It keeps your other settings.

```bash
git clone https://github.com/conscius-labs/conscius-plugin
```

```bash
node conscius-plugin/install.mjs codex --write
```

| Tool | Installer name | It writes | You then | How far it's been tested |
|---|---|---|---|---|
| Codex CLI | `codex` | `~/.codex/hooks.json`, and the skill in `~/.codex/skills/` | Add `[mcp_servers.conscius]` with `url = "https://mcp.consci.us/mcp"` to `~/.codex/config.toml`, and trust the hooks with `/hooks` | Run in the real CLI against the live service, without the `/hooks` prompt (headless) |
| Gemini CLI | `gemini` | `~/.gemini/settings.json`, with the server, and the `/conscius:contribute` command | Nothing | Run in the real CLI against the live service (headless) |
| Cursor | `cursor` | `~/.cursor/hooks.json` | Add `https://mcp.consci.us/mcp` in Cursor's MCP settings | **Not yet run in Cursor,** built from its docs |
| GitHub Copilot CLI | `copilot` | `~/.copilot/hooks/conscius.json` | Add `https://mcp.consci.us/mcp` in Copilot's MCP settings | **Not yet run in Copilot,** built from its docs |
| OpenCode V2 (2.2 and later) | `opencode` | `~/.config/opencode/opencode.json`, with the server | Nothing | **Not yet run in OpenCode,** built from its source; the hook it uses is marked experimental |

If you try one of the untested ones, please [tell us how it went](https://github.com/conscius-labs/conscius-plugin/issues).

**In Codex,** tools from MCP servers are hidden until the model searches for them, which is why it gets the skill. `--instructions` also adds one line to `~/.codex/AGENTS.md`. Codex asks you before each proposal, since `conscius_propose` writes.

**For unattended runs,** remember that these CLIs read their API key from an environment variable and an agent's shell can inherit it. Give Codex `[shell_environment_policy] inherit = "core"`, and Gemini `"tools": {"exclude": ["run_shell_command"]}`.

## Just the skill

`skill/conscius/` is a folder in the [Agent Skills](https://agentskills.io) format. Copy it into your tool's skills folder, such as `~/.codex/skills/conscius`. It doesn't connect the server, so add that too, and it has no screen: only the hooks above check a proposal on your machine.

Claude Code doesn't need it, because the server's own instructions tell the agent when to look up.

## What leaves your machine

- **A lookup** sends the name of a thing and what you asked about it to `mcp.consci.us`. See the [privacy policy](https://consci.us/privacy).
- **A proposal** sends the fact, its source page and the sentence that states it, and records who sent it for moderation. After a hold of up to 24 hours it becomes public open data (CC0). See the [terms](https://consci.us/terms).

Installing this doesn't stop an agent from proposing on its own: the reminder is what's opt-in, and in our tests Codex and Gemini CLI agents often proposed without it. To stop proposals from a machine or a project, set `{"write_back": "off"}` in a policy file, below.

## The write-back policy

With a key there's a second, server-side setting: a person's choice on the console's Account page, and a company's rule or default. Sharing is on until one of them turns it off, and nobody is asked up front. The plugin's policy applies first, on the machine.

A JSON file decides what may be proposed from this machine. The first one found wins:

| Where | For |
|---|---|
| `/Library/Application Support/Conscius/policy.json` (macOS), `/etc/conscius/policy.json` (Linux), `%ProgramData%\Conscius\policy.json` (Windows) | A company's managed policy. Users can't override it. |
| `CONSCIUS_POLICY` | A file named in the environment |
| `.conscius/policy.json` in the project | One project |
| `~/.conscius/policy.json` | One person |

```json
{
  "write_back": "ask",
  "allow_source_domains": ["python.org", "docs.github.com", "postgresql.org"],
  "block_source_domains": ["corp.example.com"],
  "block_terms": ["Project Falcon", "Acme Internal"],
  "allow_properties": ["latest stable version", "release date", "license"]
}
```

- **`write_back`:** `on` (proposals are allowed, and the reminder runs), `ask` (the same, and the tool asks the user to approve each proposal, where it can ask), or `off` (nothing is proposed, and the reminder stays quiet). With no policy, an agent may propose on its own, and the reminder stays off.
- **`allow_source_domains`:** if set, only facts from these domains are proposed. A domain covers its subdomains; `*.example.com` means subdomains only.
- **`block_source_domains`:** never these.
- **`block_terms`:** never a proposal containing one of these, as whole words, in any field. Client names and project code names go here.
- **`allow_properties`:** if set, only these properties, by the words agents use.
- **`remind_for`:** what the end-of-task reminder asks the agent to propose: `unsettled` (the default: facts Conscius was missing, or had as single-source, contested, stale or only a record), `missing` (only facts or things it didn't have), or `wanted` (only missing facts that other agents also looked for, from the wanted list).
- **`max_reminders`:** the most end-of-task reminders in one session (default 3; 0 turns them off). Each reminder names only what was looked up since the last one, and the last says so.
- **`submit`:** `now` (the default) or `queued`: proposals that pass the screen wait in `~/.conscius/queue.jsonl` (or `CONSCIUS_QUEUE`) and are sent after the session by a SessionEnd hook, to the REST API without a key, so what a session looked up and what it shares aren't tied together. The agent is told the proposal is queued. `submit_delay_hours` (up to 168) makes each one wait a random time within that window, then go at the next session's end, so arrival times don't point at a session. A company's cautious default: `{"write_back": "on", "submit": "queued", "allow_properties": [...]}`.
- **`public_terms`:** names the screen must not take for the user's own: the company's name, a public repository's name. A term listed here is never screened.
- **`collisions`:** what to do when a short identity term (a login that is also a word, a one-word repository name or owner, a one-word name) appears in context, next to "by", "user", "@" or in a code host's path: `ask` (the default; where the tool can't ask, it blocks), `block`, or `allow`, which records the match's kind in the sent log. Such a term out of context is ignored: it is a word others use. An email address, a path, a full name, a repository name with separators or a listed private term is a likely leak and is always blocked.
- **A file that can't be read or parsed turns write-back off** until it's fixed.

Whatever the policy says, a proposal citing `localhost`, a private address, a bare intranet name, or a public-looking name that resolves to a private address is refused.

### Rolling it out to a company

Put the policy at the managed path with your device management, and the plugin and server with Claude Code's managed settings (`managed-settings.json`, `managed-mcp.json`). For a cautious start, ship `{"write_back": "off"}`: reads work, nothing is sent.

## Removing it

In Claude Code:

```bash
claude plugin uninstall conscius@conscius-labs
```

```bash
claude plugin marketplace remove conscius-labs
```

In other tools, remove the Conscius entries from the file listed above, then delete the clone. Either way, `~/.conscius/` stays until you delete it: it holds the sent log, and any policy file and queue you have.

## Questions and problems

- **A problem with a fact,** such as one that's wrong or about you: [mcp.consci.us/notices](https://mcp.consci.us/notices).
- **A problem with this code:** [open an issue](https://github.com/conscius-labs/conscius-plugin/issues). This repository is built from a private one, so a fix may reach here in a later copy rather than through a merged pull request.

## License

CC0-1.0, like the facts themselves: see [`LICENSE`](LICENSE). As CC0 says, it doesn't cover trademarks or patents. Conscius has a patent application pending.
