# The Dig website

The public website for The Dig. The Dig pools estate sales from the public listing boards into one map per city. Facts shown, always linked back to the source listing.

Live site: https://rheinze08.github.io/the-dig-web/

The site is static. `build.mjs` reads the live public feeds in [the-dig-data](https://github.com/rheinze08/the-dig-data) and writes every page into `docs/`, which GitHub Pages serves. No sale is stored in this repo's source. It needs Node 18 or newer and nothing else.

## Pages

| Address | What it is |
| --- | --- |
| `/` | What The Dig is, the map and list for the default city, and the Android app download |
| `/<city>/` | Map and list of every sale in that city's feed |
| `/<city>/this-weekend/` | The same city, only sales open the coming Friday to Sunday (city time) |
| `/sale/<sale-id>/` | One sale: title, company, address or "Address releases closer to the sale", session dates and hours, source link, and schema.org Event data |
| `/list-your-sale/` | How direct listing will work, with a button that opens a prefilled email |
| `/agents.txt`, `/llms.txt` | A short plain-text card for AI agents and search tools |
| `/sitemap.xml`, `/robots.txt` | For search engines |
| `/build.json` | What the last build read: cities, sale counts, feed times |

## Rebuild and publish

```bash
./build.sh             # fetch the feeds, regenerate docs/, check it, commit and push
./build.sh --no-push   # regenerate and check only
node serve.mjs         # preview docs/ at http://127.0.0.1:4173/the-dig-web/
node test/live.mjs --feed   # prove the live site matches docs/ and the feed
```

The push is the deploy. If a feed cannot be read or the generated site fails `test/check.mjs`, nothing is committed and the published site stays as it was.

## Where the cities come from

1. If the-dig-data has `cities.json`, every city there with `"enabled": true` and a `feedUrl` gets pages. The index's `defaultCity` is the home page city.
2. Without the index, the site is Houston from the root `sales.json`, plus any city whose feed exists at `cities/<slug>/sales.json`.

New cities need no change here. They appear on the next rebuild.

## Settings

All at the top of `build.mjs`:

- `LISTING_EMAIL` is where the "List your sale" button sends mail. **It is the placeholder `listings@thedig.example` and does not receive mail.** Replace it with a real address before the page can take listings. While it ends in `.example`, the page and `agents.txt` say the address is not live.
- `SITE_URL` is the public address. Change it when a domain is chosen. Every link, the sitemap and the share tags follow it.
- `DATA_REPO` is the feed repository.

The app download button links the latest release of the-dig-data that has an APK.

## Daily rebuild

`ci/daily-rebuild.yml` is a GitHub Action that runs `./build.sh` once a day and confirms the live site took the new build. GitHub only lets a login with the `workflow` permission add workflow files, so it waits in `ci/` until someone with that permission installs it:

```bash
gh auth refresh -h github.com -s workflow   # once; approve in the browser
./ci/install-daily-rebuild.sh               # moves it to .github/workflows/ and starts the first run
```

Or add it on the GitHub website: create the file `.github/workflows/daily-rebuild.yml` with the contents of `ci/daily-rebuild.yml`, then delete the copy in `ci/`.

Until it is installed, the site changes only when someone runs `./build.sh`.

Pages are built for one calendar day in the city's time zone. If a visitor arrives after that day, `assets/site.js` corrects the "Open today" and "Ended" labels in the browser.

## Not on a custom domain yet

On `rheinze08.github.io/the-dig-web/` the site is not at the root of its host. Crawlers only read `robots.txt`, `agents.txt` and `llms.txt` from a host's root, so those three files take full effect once the site has its own domain. The sitemap can be submitted to search engines by its full address today.

## Credits

Map tiles and some locations: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Map library: [Leaflet](https://leafletjs.com/). Fonts: DM Sans and DM Serif Text, under the SIL Open Font License (`static/assets/fonts/`).
