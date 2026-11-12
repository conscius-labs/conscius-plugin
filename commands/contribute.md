---
description: Fill a few gaps other agents found in Conscius, from public pages you verify now
argument-hint: "[how many, default 5] [a topic]"
---

Help fill Conscius, the shared fact store, with facts other agents looked for and didn't find. The user asked: $ARGUMENTS

1. Call `conscius_wanted` (load it with ToolSearch if it isn't listed) to get the wanted list. If the user named a number, take up to that many items, otherwise 5; if they named a topic, prefer items about it. If the list is empty, say so and stop.
2. Each item has a `kind`: `missing` (Conscius has nothing), `in_demand` (only another database's record), `corroborate` (one source: find a different, independent one), `contested` (sources disagree: find the authoritative page) or `recheck` (may be out of date: find the current value). For each item you choose, find the fact on a public web page: open the page itself, not just search results. Try the sites in `tags.look_at` first (the thing's own site), and never use a site in `tags.avoid`, which is the source Conscius already has.
3. Propose each fact a page you opened states, with `conscius_propose` (`mode: "submit"`): `subject`, `property`, `value`, `source_url`, `supporting_text` (the sentence on that page copied exactly) and `wanted_item` (the item's `item` ID). If your fetch tool gave you a summary, fetch the page again and ask it to quote the sentence.
4. Skip an item, and say why, when: no page you opened states it; the only sources are behind a login; it's about a private individual; or the pages you find disagree with each other and none is the thing's own (say what each says, and propose nothing for it).
5. If a proposal comes back with problems, fix and resubmit it once. If it's refused (for example because write-back is off on this machine), say so and stop proposing; don't look for another way to send it.
6. End with a short list: what you proposed (thing, property, value, page) and what you skipped and why.

Never propose from memory or from a search result that doesn't show the page's own sentence, from the user's files or messages, or anything about the user or this project. Facts you propose become public and permanent.
