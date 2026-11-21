# The Dig, Phase 7: public website

The website is live at **https://rheinze08.github.io/the-dig-web/** and shows the same 28 Houston sales as the feed. Two things still need Roland: one approval so the daily rebuild can be switched on, and a real email address for the listing page. Both are spelled out under "Needs Roland".

- Repo (public): https://github.com/rheinze08/the-dig-web
- Live site: https://rheinze08.github.io/the-dig-web/

## Proof the live site matches the feed

Fetched with no login on 2026-11-21 at 01:34 UTC, after GitHub Pages finished deploying commit `dd320a9`:

| Check | Result |
| --- | --- |
| `GET https://rheinze08.github.io/the-dig-web/` | HTTP 200 |
| Sale count shown on the home page | **28** ("28 estate sales in the Houston feed.") |
| Houston feed, root `sales.json` | HTTP 200, **28** sales, collected 2026-11-21T01:26:19Z |
| Houston feed, `cities/houston/sales.json` | HTTP 200, **28** sales |
| `/houston/`, `/houston/this-weekend/`, `/list-your-sale/` | HTTP 200 each |
| `/agents.txt`, `/llms.txt`, `/robots.txt`, `/sitemap.xml` | HTTP 200 each |
| `/sale/917efdb9740a5300/` | HTTP 200, Event data 2026-11-18T09:00-06:00 to 2026-11-21T16:00-06:00 |
| An address that does not exist | HTTP 404 with the site's own "not here" page |

Repeat it any time with `node test/live.mjs --feed`.

The live site was also opened in a headless browser. The map drew all 28 pins on OpenStreetMap tiles, a pin's popup linked to its sale page, the sale page showed its address, four sessions and the EstateSales.net link, and the browser reported no errors.

## Needs Roland

### 1. Switch on the daily rebuild (one approval)

The daily Action is written but **not installed and has never run on GitHub**. GitHub refused the push: the GitHub login on this machine has the `repo` permission but not `workflow`, and only a login with `workflow` may add an Action. Until it is installed, the site changes only when someone runs `./build.sh`.

The file waits at `ci/daily-rebuild.yml`. Either of these installs it:

- **In a browser, signed in as rheinze08:** open [this prefilled new-file page](https://github.com/rheinze08/the-dig-web/new/main?filename=.github%2Fworkflows%2Fdaily-rebuild.yml&value=%23%20Daily%20rebuild%20of%20The%20Dig%20website.%0A%23%20One%20short%20run%20a%20day%3A%20fetch%20the%20feeds%2C%20regenerate%20docs%2F%2C%20commit%20and%20push%20if%0A%23%20anything%20changed%2C%20then%20confirm%20the%20live%20site%20serves%20the%20new%20build.%0A%23%20GitHub%20runs%20this%20only%20from%20.github%2Fworkflows%2F.%20See%20README%2C%20%22Daily%20rebuild%22.%0Aname%3A%20Daily%20rebuild%0A%0Aon%3A%0A%20%20schedule%3A%0A%20%20%20%20%23%2011%3A37%20UTC%20is%205%3A37%20AM%20Central%20in%20winter%20and%206%3A37%20AM%20in%20summer%2C%20before%20sales%20open.%0A%20%20%20%20-%20cron%3A%20'37%2011%20*%20*%20*'%0A%20%20workflow_dispatch%3A%0A%0Apermissions%3A%0A%20%20contents%3A%20write%0A%20%20pages%3A%20write%0A%0Aconcurrency%3A%0A%20%20group%3A%20daily-rebuild%0A%20%20cancel-in-progress%3A%20false%0A%0Ajobs%3A%0A%20%20rebuild%3A%0A%20%20%20%20runs-on%3A%20ubuntu-latest%0A%20%20%20%20timeout-minutes%3A%2010%0A%20%20%20%20steps%3A%0A%20%20%20%20%20%20-%20uses%3A%20actions%2Fcheckout%40v5%0A%0A%20%20%20%20%20%20-%20name%3A%20Rebuild%20and%20publish%0A%20%20%20%20%20%20%20%20env%3A%0A%20%20%20%20%20%20%20%20%20%20GITHUB_TOKEN%3A%20%24%7B%7B%20github.token%20%7D%7D%0A%20%20%20%20%20%20%20%20run%3A%20%7C%0A%20%20%20%20%20%20%20%20%20%20git%20config%20user.name%20'github-actions%5Bbot%5D'%0A%20%20%20%20%20%20%20%20%20%20git%20config%20user.email%20'41898282%2Bgithub-actions%5Bbot%5D%40users.noreply.github.com'%0A%20%20%20%20%20%20%20%20%20%20.%2Fbuild.sh%0A%0A%20%20%20%20%20%20-%20name%3A%20Confirm%20the%20live%20site%0A%20%20%20%20%20%20%20%20env%3A%0A%20%20%20%20%20%20%20%20%20%20GH_TOKEN%3A%20%24%7B%7B%20github.token%20%7D%7D%0A%20%20%20%20%20%20%20%20run%3A%20%7C%0A%20%20%20%20%20%20%20%20%20%20if%20node%20test%2Flive.mjs%20--wait%20240%3B%20then%20exit%200%3B%20fi%0A%20%20%20%20%20%20%20%20%20%20echo%20'The%20push%20has%20not%20reached%20the%20live%20site.%20Asking%20GitHub%20Pages%20to%20build.'%0A%20%20%20%20%20%20%20%20%20%20gh%20api%20-X%20POST%20%22repos%2F%24GITHUB_REPOSITORY%2Fpages%2Fbuilds%22%0A%20%20%20%20%20%20%20%20%20%20node%20test%2Flive.mjs%20--wait%20240%0A) and press "Commit changes". If the editor opens empty, paste the contents of `ci/daily-rebuild.yml`. I could not test the prefilled link because it needs your sign-in.
- **Or on this machine:** run `gh auth refresh -h github.com -s workflow`, approve it in the browser, then run `./ci/install-daily-rebuild.sh`. That moves the file into place and starts the first run.

What it does once installed: one run a day at 11:37 UTC (5:37 AM Central in winter, 6:37 AM in summer). It runs `./build.sh`, then checks that the live site serves the new build. If the push did not reach the live site, it asks GitHub Pages to build and checks again, and fails loudly if that does not work.

What is proven and what is not: `./build.sh` ran clean in a fresh clone with nothing but Node and git. The Action's own steps on GitHub (the bot's push and the live-site check) are untested until the first run. Please look at that first run in the Actions tab.

### 2. Give the listing page a real email address

`/list-your-sale/` has the button that opens the visitor's email app with a "List my sale on The Dig" message. It is addressed to the placeholder **`listings@thedig.example`**, which cannot receive mail. **The page cannot take listings until you give me a real address, or a domain to make one on.**

It is one value, `LISTING_EMAIL`, at the top of `build.mjs`. While it is the placeholder, the page shows a "Not live yet" note under the button and `agents.txt` says no contact address is live, so no company is misled into mailing a dead address. Both notes disappear on the first rebuild after the address is real.

## What was built

Every build reads the live feeds. No sale is stored in the site's source.

| Address | What it is |
| --- | --- |
| `/` | What The Dig is, the Houston map and list, and the Android app button |
| `/houston/` | Map with a pin per sale, and the sale list |
| `/houston/this-weekend/` | Houston sales open the coming Friday to Sunday, Central Time. Today that is 22 of 28. |
| `/sale/<sale-id>/` | 28 pages, one per sale: title, company, address or "Address releases closer to the sale", session dates and hours, source link, and Event structured data |
| `/list-your-sale/` | How free direct listing will work, with the prefilled email button |
| `/agents.txt`, `/llms.txt` | The card for AI agents and search tools |
| `/sitemap.xml`, `/robots.txt` | 32 addresses in the sitemap |

- **Cities.** The city index (`cities.json`) appeared in the-dig-data while I was building, so the site now builds from it. Houston is the only enabled city. A new city gets its pages on the next rebuild with no change here. If the index ever goes missing, the site falls back to the Houston root feed plus any `cities/<slug>/sales.json` it finds.
- **App button.** It links the latest the-dig-data release that has an APK. v0.2.0 was published during the build, so the button links v0.2.0. The lookup repeats on every rebuild.
- **Search.** Every page has its own title and description written around "estate sales in Houston" and "estate sales near me", plus share tags and a share image.
- **agents.txt and llms.txt** are at https://rheinze08.github.io/the-dig-web/agents.txt and https://rheinze08.github.io/the-dig-web/llms.txt. Both carry the same card: what The Dig is, the city list, each city's feed address, how to cite, and the placeholder contact note.
- **Deploy.** `./build.sh` fetches the feeds, regenerates `docs/`, checks it and pushes. GitHub Pages serves `docs/` from `main`, so the push is the deploy. A feed that cannot be read, or a generated site that fails the check, stops before anything is committed.

## Good to know

- **No custom domain.** As agreed, the site lives at its github.io address. One consequence: crawlers only read `robots.txt`, `agents.txt` and `llms.txt` from the root of a host, and this site sits under `/the-dig-web/`. Those three files take full effect once the site has its own domain. Changing `SITE_URL` at the top of `build.mjs` moves every link, the sitemap and the share tags.
- **Ended sales stay counted.** The count shown is always the feed's count. A sale whose last day has passed stays in the list with an "Ended" label and sorts last. Nothing has ended as of today's build.
- **Stale days fix themselves in the browser.** A page is built for one calendar day in Central Time. A visitor arriving on a later day gets corrected "Open today" and "Ended" labels and a short note. I tested this by moving the browser clock forward three days.
- **Feed timing.** The site picks up a feed refresh at its next rebuild. If the foundation thread wants the site to follow a refresh at once, `refresh.sh` can end with `gh workflow run daily-rebuild.yml --repo rheinze08/the-dig-web` once the Action is installed. I did not touch the-dig.
- **Things I added that were not on the list:** the "Not live yet" note on the listing page, a "not here" page for sale pages that have come down, and `/build.json`, which records what the last build read.

## Checks run

- `test/check.mjs` on every build: every internal link resolves, each count shown equals the feed's, all 28 sale pages carry valid Event dates, and the sitemap matches the pages.
- Builds against test feeds: two cities with an index, no index with a discovered city folder, a different time zone, sales with no map point or no hours, and titles containing script tags and quotes (escaped everywhere; a `javascript:` source link was dropped).
- Bad feeds (an invalid sale id, a missing feed) stop the build and leave `docs/` untouched.
- Screenshots of every page type at desktop and phone width, checked by eye.
