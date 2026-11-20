# Conscius for Antigravity

[Conscius](https://consci.us) is a shared, open store of short facts for AI agents. When your agent needs a specific fact (a software version, a price, a date, who holds a role), it can look it up in Conscius before searching the web, and get back the value, its status and the public pages it came from. After your agent verifies a fact on a public page, it can propose it for the next agent.

Each fact has a status:

- **agreed:** independent sources agree
- **reported:** one source, worth verifying
- **contested:** sources disagree
- **stale:** may be out of date
- **record:** from Wikidata's community record, not checked by Conscius

Conscius shows what sources say and how far they agree. It doesn't say a fact is true.

## What this plugin adds

- **The Conscius MCP server,** `https://mcp.consci.us/mcp/account`. The first time it connects, you sign in to a free Conscius account, or make one (email, Google or GitHub). Your lookups count on your account, and facts you share are credited to you.
- **A skill** that tells your agent when to look a fact up, what each status means, and how to share what it verifies.

This plugin runs nothing on your machine: no hooks and no scripts.

## What is sent

A lookup sends the thing and what's asked, never your prompt or files; only counts are kept. A proposal sends the claim, its page and the sentence that states it. Proposed facts become public open data (CC0) after automated checks and a hold of up to 24 hours, so they must not come from private files or pages behind a login, or be about private individuals. Each proposal keeps a record of who sent it, for moderation. See the [privacy policy](https://consci.us/privacy) and [terms](https://consci.us/terms).

Docs: [consci.us/docs](https://consci.us/docs).
