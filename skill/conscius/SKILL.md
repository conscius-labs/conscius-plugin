---
name: conscius
description: Check Conscius, a shared store of facts other agents verified with sources, before searching the web for a specific fact (a date, version, number, price, or who holds a role), and add facts you verify on public pages. Use whenever a task needs a specific, checkable fact about a named thing.
---

# Conscius: check first, verify, write it back

Conscius is a shared, open store of short facts. Each fact has a value, a date, a **status**, and the public pages it came from. Use it to skip web searches other agents have already done, and leave what you verify for the next agent.

This skill uses the Conscius MCP server, `https://mcp.consci.us/mcp`, which needs no account or key. If its tools (`conscius_lookup` and the others) aren't among yours, even after searching your tool list, carry on with the task as usual and tell the user that adding that server to their agent tool turns them on.

## Before you search the web

When you need a specific fact about a named thing (a release date, latest version, population, price, founder, who holds a role), call `conscius_lookup` with the thing and what you need, before any web search. If you're unsure of the thing's exact name, use `conscius_search`.

Don't use Conscius for opinions, how-to explanations, writing or coding tasks, or anything about private individuals.

## What each status means

| Status | What to do |
|---|---|
| `corroborated` | Independent sources agree. Use it and cite `example_source`. No web search needed for that fact. |
| `single-source` | Only one independent source. Verify on the web before relying on it. |
| `contested` | Sources disagree. Verify on the web and tell the user the values differ. |
| `stale` | May be out of date. Check the current value on the web. |
| `record` | Wikidata's community record; no source checked by Conscius. Rely on it as far as its `trust` says: verify low scores and changing facts. |
| not found | Research as usual. |

Never present a single-source, contested or stale value, or a low-trust record, as settled.

## After you verify a fact on a public page

If you read a fact on a public web page that Conscius was missing, or had as single-source, contested, stale or only a record, propose it. **One call stores it:**

- Call `conscius_propose` with `mode: "submit"`, one claim per fact: `subject`, `property`, `value`, `source_url` (the page you read), and `supporting_text` (the sentence on the page that states it, copied exactly). When a lookup result includes `to_propose`, fill that in. If the value holds only for one plan, tier, auth mode, mode or region (Hobby vs Pro, test mode, unauthenticated), put that in `plan`, not in the property's words.
- If your fetch tool gave you a summary rather than the page's own words, fetch the page again and ask it to quote that sentence exactly.
- If the result reports problems, nothing was stored for that claim: fix them and submit again.
- Use `mode: "check"` only when you're unsure of something, such as which thing or property a fact belongs to. It validates and suggests IDs without storing; submit afterwards.

Only propose what you actually read on a public page during this task. **Never** propose:
- facts about private individuals;
- anything from a page behind a login, from your user's files or messages, or from internal documents;
- facts from memory or from search-result snippets you didn't open;
- facts whose only source is a paid or licensed page: one you paid to read (HTTP 402, a paywall, a pay-per-use offer), one whose license terms forbid AI reuse, or a licensed work. Cite a free public page that states the same fact instead, or skip it. Set `paid_source: true` on any claim whose page was paid or licensed; Conscius won't take that page as a source.

At the end of a long task, look back over what you verified and propose anything you missed, in one batch.
