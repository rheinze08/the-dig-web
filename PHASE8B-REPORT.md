# The Dig — Phase 8B report: regions page and search across cities

Checked live on 2026-11-21 at 02:27 UTC (Nov 20, 8:27 PM Central), without any login.

**Result: the regions page and the search page are live, and both match the city index.** Houston is the only live city today. No proving city has a feed yet, so no preview page exists on the live site. The preview pages are built and tested, and will appear on the first rebuild after 8A publishes a proving feed.

| Page | Address | Status |
| --- | --- | --- |
| Regions | https://rheinze08.github.io/the-dig-web/regions/ | HTTP 200 |
| Search | https://rheinze08.github.io/the-dig-web/search/ | HTTP 200 |
| Search data | https://rheinze08.github.io/the-dig-web/search/data.json | HTTP 200 |
| agents.txt | https://rheinze08.github.io/the-dig-web/agents.txt | HTTP 200 |
| llms.txt | https://rheinze08.github.io/the-dig-web/llms.txt | HTTP 200 |

## 1. Regions page: counts against the index

| City | City index | Houston feed | `/regions/` | Home page strip |
| --- | --- | --- | --- | --- |
| Houston (live) | 28 sales, `enabled: true` | 28 sales | 28, under "Live now", links `/houston/` | 28 |

The page has the three sections asked for:

- **Live now:** Houston, 28 estate sales, 22 open this weekend, collected Nov 20, 2026, linking to its city page.
- **On the way (Preview):** today it reads "No city is in preview today. A city appears here, with its real count, on the first daily rebuild after its feed is published."
- **More states coming:** "Texas is first, and more states are being scouted. No place is named here and no count is shown until a real feed stands behind it."

"Regions" and "Search" are in the header and the footer of every page (35 pages, checked on each one by `test/check.mjs`). The home page has a "Where The Dig works" strip under the hero with each city, its count, and a link to `/regions/`.

## 2. Search: the keyword test

Keyword: **beatles**. It appears in one real Houston title in the live feed.

```
Search for "beatles" in the live data file -> 1 result.
  A Lifetime of Memories, Beautifully Collected: Decor, Beatles, Star Wars & More! | Virtue Estate Sales | houston | 2026-11-18 to 2026-11-21 | https://rheinze08.github.io/the-dig-web/sale/917efdb9740a5300/ -> HTTP 200
Live Houston feed: 1 title has "beatles" (917efdb9740a5300); search returned 1 of them.
```

The same search in a real browser on the live page: typing "beatles" changes the count to "1 of 28 sales matches", shows that one sale with its company (Virtue Estate Sales), and its link opens `/sale/917efdb9740a5300/`. The Collectibles chip narrows to 4 of 28 and the address becomes `/search/?cat=collectibles`, so a search can be shared as a link.

What the page does:

- One search box and the twelve category chips. Results are grouped by city. Each result shows title, company, city, dates and its categories, and links to its sale page. A result count updates as you type.
- The site stays fully static. The build writes all 28 results into the page and writes `/search/data.json` beside it. The visitor's browser filters the list from that file. Nothing is sent to a server. Without JavaScript the page still lists every sale.
- A keyword matches the start of any word in a sale's title, company or categories.
- The line you asked for is on the page word for word: "Search covers listing titles and companies today — searching inside photos is coming later."

**One thing to know about the chips today.** `search.json` was not published when this was built (HTTP 404), so categories are read from listing titles. Houston titles rarely name what is for sale, so only three chips have sales: Collectibles 4, Furniture 2, Art 2. The other nine show 0 and are greyed out. The page says so: "Categories are read from each listing's title, so a sale can be missing from a category it belongs in." When 8A publishes `search.json`, the next rebuild takes categories from it with no change here.

## 3. Preview pages: none live yet

The city index names Dallas–Fort Worth, Austin and San Antonio, all with `enabled: false`, no feed address and no count. No feed exists at `cities/<slug>/sales.json` for any of them. The data repo's `cities/` folder holds only `houston`. So:

- There is no preview page to fetch. `/austin/`, `/dallas-fort-worth/` and `/san-antonio/` return HTTP 404, and nothing on the site links to them.
- These three cities are not named on any page. A city with no feed has no real count, and you asked for no invented counts. `build.json` lists them under `offSite` with the reason "no feed yet".

**How the structure handles a proving city** was proven with made-up feeds (`node test/preview.mjs`, which never touches the live site):

```
Preview test passed: proving city pages with the banner, cities without a feed left off, search across both cities, search.json switch-over, today's index shape.
```

That test builds a site from a test index and confirms:

- A proving city with a feed gets a city page, a weekend page and a sale page for every sale. Each one carries the banner "Preview — still proving itself."
- `/regions/` lists it under "On the way" with a Preview label, its real count and its collected date. The home strip lists it too.
- Its sales appear in search under their own city heading with a Preview label, and each result links to a sale page that exists.
- A proving city with no feed, or with a broken feed, is left off the site and does not stop the live cities from rebuilding.
- It works with the index as it is today (`enabled` true or false) and with the `status` and `cleanRuns` fields 8A is adding. If the index states `cleanRuns`, the regions card shows "N clean collection runs so far".
- When `search.json` exists, categories come from it. A sale in `search.json` that has no page on the site is dropped, so a result can never link to a dead page.

## 4. agents.txt and llms.txt

Both are rebuilt from the index on every build and are identical. Confirmed live:

- Cities are listed under "Live" (Houston, with its page, weekend page, feed, count and collection time) and "Proving (preview)" ("None at this build", plus a count of the three index cities that have no pages yet).
- A new "Regions and search" section gives the regions page, the search page, the link format for a search, the search data file and the twelve category ids.
- "Public data" names `search.json` as the combined feed and says it was not published when the site was built.

## What changed in the repo

| Commit | What |
| --- | --- |
| `08d8c0b` | Regions page, search page, preview cities, new agent card, tests |
| `1fe4a71` | README updated. The `ci/` staging copy of the daily rebuild was removed because the Action is now installed |
| `ea5a621` | The published rebuild (`./build.sh`) |

The daily Action was not touched. It ran successfully once already, and it runs the same `./build.sh` and `test/live.mjs`, so it picks all of this up.

To repeat the proof: `node test/live.mjs --feed --keyword beatles`. The Beatles sale ends Nov 21, so after it leaves the feed, drop `--keyword` and the test picks a word from a current title.

## For you to decide

1. **Naming the next cities.** The site does not name Dallas–Fort Worth, Austin or San Antonio until each has a feed. If you would rather announce them now as "next, no count yet", say so. It is a small change.
2. **Preview pages and search engines.** Preview city pages are open to search engines, the same as live ones, with the banner on every page. If you want them hidden from search engines until a city goes live, say so.
3. Still open from Phase 7: the "List your sale" address is the placeholder `listings@thedig.example`, and no custom domain is chosen.
