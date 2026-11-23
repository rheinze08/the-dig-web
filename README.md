# The Dig website

The public website for The Dig. The Dig pools estate sales from the public listing boards into one map per city. Facts shown, always linked back to the source listing.

Live site: https://rheinze08.github.io/the-dig-web/

The site is static. `build.mjs` reads the live public feeds in [the-dig-data](https://github.com/rheinze08/the-dig-data) and writes every page into `docs/`, which GitHub Pages serves. No sale is stored in this repo's source. It needs Node 18 or newer and nothing else.

## Pages

| Address | What it is |
| --- | --- |
| `/` | What The Dig is, the map and list for the default city, and the Android app download |
| `/regions/` | Where The Dig works: live cities, preview cities, and the note that more states are coming |
| `/map/` | Sale pins colored by Dig rating, with a switcher for live and Preview cities. Opens on Houston. A city link such as `/map/?city=austin` opens that city directly |
| `/search/` | Keyword search across cities with category, favorites, city, rating, weekend and photo filters. The page holds every result and `assets/search.js` filters it in the browser |
| `/search/data.json` | The records the search page filters, including city, session dates, photo counts and available Dig ratings |
| `/<city>/` | Map and list of every sale in that city's feed. A preview city's pages carry a "Preview — still proving itself" banner |
| `/<city>/this-weekend/` | The same city, only sales open the coming Friday to Sunday (city time) |
| `/sale/<sale-id>/` | One sale: title, company, full address or city + ZIP with the release time, session dates and hours, source link, schema.org Event data, a Directions link and a favorite heart. When the feed carries them, also the Dig rating with its reasons, the contents line and keyword chips, the photo count at the source, and Call / Company page buttons |
| `/sale/<sale-id>/<date>.ics` | An "Add to calendar" file for one sale day, with the address, the source link and the contents line |
| `/list-your-sale/` | How direct listing will work, with a button that opens a prefilled email |
| `/agents.txt`, `/llms.txt` | A short plain-text card for AI agents and search tools |
| `/sitemap.xml`, `/robots.txt` | For search engines |
| `/build.json` | What the last build read: cities and their status, sale counts, feed times, cities left off and why, where search categories came from, and how many sales carry each photo-derived field (`enriched`) |

## Rebuild and publish

```bash
./build.sh             # fetch the feeds, regenerate docs/, check it, commit and push
./build.sh --no-push   # regenerate and check only
node serve.mjs         # preview docs/ at http://127.0.0.1:4173/the-dig-web/
node test/live.mjs --feed   # prove the live site matches docs/, the feeds and the city index
node test/live.mjs --feed --keyword beatles   # the same, searching the live data for a word you choose
node test/preview.mjs       # test preview cities and search.json with made-up feeds (never touches docs/)
node test/favorites.mjs     # test the favorites hearts against a fake browser
```

The push is the deploy. If a feed cannot be read or the generated site fails `test/check.mjs`, nothing is committed and the published site stays as it was.

## Where the cities come from

`cities.json` in the-dig-data is the authority. Nothing about any city is kept in this repo.

| The index says | The site does |
| --- | --- |
| `"status": "live"`, or no status and `"enabled": true` | **Live.** Full pages. The feed must be readable or the build stops and the published site stays as it was. |
| `"status": "proving"`, or no status and not enabled | **Preview**, once its feed exists (the index's `feedUrl`, or `cities/<slug>/sales.json`). Same pages as a live city, each with the "Preview — still proving itself" banner. |
| A proving city whose feed is not there yet, or does not read cleanly | The map switcher lists the city as Preview and shows that its feed is unavailable. The build omits its city page and records the reason in `build.json` under `offSite`. |
| Any other status | Left off the site, listed under `offSite`. |

The index's `defaultCity` is the home page city if it is live. A sale two cities both list keeps one page, under the first city, and live cities come first. Counts on the site are always the number of sales in the feed. If the index states a different count, the build prints a note.

Without the index, the site is Houston from the root `sales.json`, plus a preview of any city whose feed exists at `cities/<slug>/sales.json`.

New cities need no change here. A proving city appears on the first rebuild after its feed is published, and moves to "Live now" on the first rebuild after the index calls it live.

## Search

`/search/` is a static page. The build writes every sale into it, grouped by city, and writes `/search/data.json` beside it. `assets/search.js` fetches that file and hides the results that do not match. A keyword matches the start of any word in a sale's title, company, categories, photo keywords (`photoKeywords` in the feed) or contents line (`contentsLine`). Chips narrow to sales in any of the chosen categories. A search can be linked: `/search/?q=tools&cat=furniture,art`.

Favorites need no account and no server: the heart on a sale card or page stores the sale id in the visitor's browser (`localStorage`, `assets/favorites.js`), and the Favorites-only chip on `/search/` (or `/search/?fav=1`) shows only those sales.

Choosing several ratings includes a sale with any selected rating. City, photos, weekend and the existing search controls narrow that result together. “This weekend” uses scheduled sale sessions on Saturday or Sunday in America/Chicago. The current weekend stays selected through Sunday. “Has photos” requires a positive photo count, and Clear all restores the full list. The build takes ratings and photo counts from the combined search feed when published and fills missing fields from the city feed for that sale.

Where a sale's categories come from:

1. `search.json` in the-dig-data, once it is published. Its category labels are mapped onto the twelve chips. A label that is not one of the twelve is kept as a plain label on the result.
2. Until then, and for any sale `search.json` leaves out, the words in the listing's title, company and excerpt (`CATEGORIES` at the top of `build.mjs`).

The switch is automatic. `build.json` and `agents.txt` say which one the last build used. Search results are always the sale pages this build made, so a result cannot link to a missing page.

## Per-sale details from the feeds

The city feeds may carry `digRating` with `ratingReasons`, `photoKeywords`, `contentsLine`, `contactPhone`, `contactUrl` and `photoCount` per sale. The build shows each one only when it is present and reads cleanly — a rating badge with its reasons, a "What's there" section with the contents line and keyword chips, "N photos at the source" linking to the listing (photos are never copied), and Call / Company page buttons — so the site is correct before and after the data lands. Every sale also gets a Google Maps directions link and one `.ics` calendar file per sale day. While a street address is held, pages show the city and ZIP and "Address releases <weekday> 9:00 AM" for the day before the first session.

## Settings

All at the top of `build.mjs`:

- `LISTING_EMAIL` is where the "List your sale" button sends mail. **It is the placeholder `listings@thedig.example` and does not receive mail.** Replace it with a real address before the page can take listings. While it ends in `.example`, the page and `agents.txt` say the address is not live.
- `SITE_URL` is the public address. Change it when a domain is chosen. Every link, the sitemap and the share tags follow it.
- `DATA_REPO` is the feed repository.

The app download button links the latest release of the-dig-data that has an APK.

## Daily rebuild

`.github/workflows/daily-rebuild.yml` is a GitHub Action that runs `./build.sh` once a day (11:37 UTC) and confirms the live site took the new build. It can also be started by hand: `gh workflow run daily-rebuild.yml --repo rheinze08/the-dig-web`. Changing the workflow file needs a login with the `workflow` permission.

Pages are built for one calendar day in the city's time zone. If a visitor arrives after that day, `assets/site.js` corrects the "Open today" and "Ended" labels in the browser.

## Not on a custom domain yet

On `rheinze08.github.io/the-dig-web/` the site is not at the root of its host. Crawlers only read `robots.txt`, `agents.txt` and `llms.txt` from a host's root, so those three files take full effect once the site has its own domain. The sitemap can be submitted to search engines by its full address today.

## Credits

Map tiles and some locations: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Map library: [Leaflet](https://leafletjs.com/). Fonts: DM Sans and DM Serif Text, under the SIL Open Font License (`static/assets/fonts/`).
