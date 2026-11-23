# The Dig · Phase 11B verification report

The November 23, 2026 build mapped **245 of 245 feed sales** across four live cities and two Preview cities. Search returned **43 sales** with a session on November 28 or 29 and **231 sales** with photos. [Sale map](https://rheinze08.github.io/the-dig-web/map/) · [Search](https://rheinze08.github.io/the-dig-web/search/)

## Map

`build.mjs` writes the city switcher and pin data into `docs/map/index.html` on every rebuild. Houston opens by default. Selecting a city fits the view to its pins, and each city page links directly to its own map. The page uses the site's local scripts and styles, pinned Leaflet 1.9.4 from unpkg, and attributed OpenStreetMap tiles. The daily Action builds it with its existing `./build.sh` command. [Phoenix Preview map](https://rheinze08.github.io/the-dig-web/map/?city=phoenix) · [Website implementation](https://github.com/rheinze08/the-dig-web/commit/42f98a13aea2ee6173dae3aba544196a6525e561)

The switcher gets city names, slugs, status and centers from `cities.json`. Each city's `sales.json` supplies numeric `lat` and `lng`, the Boolean `approximate` flag, `digRating`, `title`, `sessions[].date` and the sale `id`. A pin requires both coordinates in range. Approximate locations use a paler fill and dashed outline. The site also treats a withheld street address as approximate. When sales share coordinates, the icons have separate screen positions and retain their original latitude and longitude. [City index at the verified feed revision](https://github.com/rheinze08/the-dig-data/blob/bc8f6310c2f337ecfeb524bc8b55b3c4966fffb7/cities.json) · [Houston feed](https://github.com/rheinze08/the-dig-data/blob/bc8f6310c2f337ecfeb524bc8b55b3c4966fffb7/cities/houston/sales.json)

Chromium compared the rendered Leaflet markers' coordinates, rating colors and approximate flags with the raw records after each city switch.

| City | Status | Feed sales | Rendered pins | Approximate pins |
| --- | --- | ---: | ---: | ---: |
| Houston | Live | 22 | 22 | 12 |
| Dallas–Fort Worth | Live | 71 | 71 | 36 |
| Austin | Live | 28 | 28 | 11 |
| San Antonio | Live | 29 | 29 | 12 |
| Phoenix | Preview | 38 | 38 | 25 |
| Atlanta | Preview | 57 | 57 | 27 |
| **Total** | | **245** | **245** | **123** |

Clicking the Houston pin at `29.3856773, -95.1281039` showed “THANKSGIVING PICKER ESTATE,” November 27–29, and “Deep Dig.” Its title link opened the matching sale page. Chromium loaded both Leaflet assets and decoded real OSM tiles. A touch test at 390 pixels wide opened a popup and confirmed its text cleared the zoom controls. [Verified sale page](https://rheinze08.github.io/the-dig-web/sale/60ec3b8089dbba26/)

The real feed contained 185 dark-green Deep Dig pins, 35 amber Worth a Look pins and 25 gray Slim Pickings pins. All sales had ratings, so a fixture supplied the unrated case. Its exact pin was blue (`#235c91`), its approximate pin pale blue (`#d9e9f8`), and the popup read “Unrated.” Fixtures also covered a missing longitude and switching away from a Preview city whose feed was unavailable.

## Search

The build joins the combined `search.json` to sale pages by ID and writes the existing local browser index at `/search/data.json`. The combined feed supplies categories, rating and photo count, with city-feed fallbacks. Each record also carries the distinct scheduled session dates from the city feed. The weekend filter checks those dates against Saturday and Sunday in `America/Chicago`. A sale whose first and last dates span a closed weekend is excluded. The current weekend stays selected through Sunday. [Combined feed at the verified revision](https://github.com/rheinze08/the-dig-data/blob/bc8f6310c2f337ecfeb524bc8b55b3c4966fffb7/search.json)

Browser checks compared the **visible sale IDs and displayed count** with independently filtered feed records. Multiple ratings match any selected rating. The other controls narrow the results together.

| Search selection | Results |
| --- | ---: |
| All sales | 245 |
| Houston only | 22 |
| Deep Dig or Worth a Look | 220 |
| This weekend, November 28–29 | 43 |
| Has photos (`photoCount > 0`) | 231 |
| Phoenix + Deep Dig or Worth a Look + this weekend + has photos | 6 |
| Same filters plus the keyword query `vin rec` | 1 |
| Clear all | 245 |

With filters cleared, the old and new keyword matchers returned identical sale IDs for `vin rec` (44), `mïd CENT` (24) and an unmatched query (0). A browser set to Honolulu still used Chicago's calendar. At 11:59:59 p.m. Chicago time on Sunday, November 29, the toggle returned 43 sales. Just after midnight Monday it returned 58 for December 5–6. [Combined filter example](https://rheinze08.github.io/the-dig-web/search/?city=phoenix&rating=Deep%20Dig&rating=Worth%20a%20Look&weekend=1&photos=1)

## Repository checks

- `./build.sh --no-push` rebuilt from the public feeds and passed `test/check.mjs` with 263 HTML pages, 245 sale pages, 262 sitemap URLs and 245 search records.
- `node test/preview.mjs` passed the fixture builds, including combined-feed overrides, skipped weekend sessions, Chicago midnight and the spring daylight-saving transition.
- `node test/favorites.mjs` passed the existing favorite persistence and failure-handling checks.
- After the push, `node test/live.mjs --feed --wait 240` passed. GitHub Pages served the built map, search data and search script byte-for-byte. A second Chromium check on the public site switched Houston's 22 pins to Phoenix's 38 and repeated the combined search, keyword and Clear all sequence (6 → 1 → 245). [Live map](https://rheinze08.github.io/the-dig-web/map/) · [Live search](https://rheinze08.github.io/the-dig-web/search/)
