# Midterm Watchfloor

**Live site: https://lawrencelu0904.github.io/midterm-watchfloor/**

A replay console for the 2026 U.S. midterms: what was happening, when and where. Kalshi prices and bets, race settlements, Reddit and Bluesky activity, election-night streams, gas prices and weather are lined up on one timeline and one map.

Open `index.html` through any static web server (this repository is served with GitHub Pages). There's no build step: plain HTML, CSS and JavaScript with a vendored copy of d3 v7.9.0.

## What you can do
- **Timeline.** Drag the cursor across the time lanes, press Play, or switch between election night, Nov 1–8 and Oct 20 – Nov 12. Amber diamonds mark key moments.
- **Map layers.**
  - Races: Kalshi odds, then the settled result.
  - Bets: dollars bet on each state's races per hour.
  - Social: comments in the state's subreddit compared with its usual hour.
  - Also gas price, rain and turnout markets.
- **State panel.** Click a state for its races, odds, bets, social activity, gas price, weather and turnout market.
- **Key moments.** The two chamber-control settlements, the biggest race calls, the sharpest price swings and the largest bets. Each moment can show the public posts made around it, through Bluesky's and Reddit's own embeds.
- **Bet explorer and bet tape.** For any race, the traded price for Democrats, the dollars backing each side, and the single largest bets.

## Data (`data/`)
Each JSON file is `{rows: [...], meta: {inputs}}`. Times are UTC Unix seconds; the page shows US Eastern time.

| file | what |
|---|---|
| `races`, `race_odds`, `milestones`, `control` | Kalshi 2026 Senate, Governor and House race markets: winner, settlement time, hourly odds; chamber-control odds (per minute on election night) |
| `bets_flow`, `bets_state`, `big_bets`, `race/<id>` | Kalshi trades, Oct 20 – Nov 12, grouped into bets (one taker order = all its fills at one instant), by which party the bet backs |
| `reddit_hourly`, `reddit_night` | Post and comment counts per hour (per minute on election night) for national political subreddits and one main subreddit per state, from the Arctic Shift Reddit archive |
| `bluesky` | Election-night Bluesky sample: top posts per candidate / state query, counts per 10 minutes and state |
| `moments` | Key moments, with links to public posts to embed |
| `streams`, `chat`, `polymarket` | Election-night political streams (on-air times), live-chat messages per minute, Polymarket comments per hour |
| `gas`, `oil`, `weather_state`, `weather_grid`, `turnout_races`, `turnout_daily` | AAA gas and WTI/Brent via Kalshi's settled markets; NOAA GHCN-Daily station weather; Kalshi turnout markets with the last midterm Senate total (MEDSL) |

## What is and isn't published
- **Published:**
  - Kalshi market data (trades are anonymous)
  - counts
  - links to public posts
- **Not published:**
  - any post text, image, username or chat message
  - any video
- **How embedded posts work:**
  - They render from Bluesky and Reddit only after a viewer clicks "Show posts", so a deleted post stops showing.
  - Bluesky embeds are limited to accounts with 25,000+ followers.

X (Twitter) is not included because its read API is paid. Polls, official vote counts and AP call times are not included yet.

## Sources
Kalshi Trade API · AAA (via Kalshi settlement values) · NOAA NCEI GHCN-Daily · MIT Election Data and Science Lab · Arctic Shift (Reddit archive) · Bluesky public API · Polymarket Gamma API · YouTube live-chat replays (counts only) · us-atlas (Census cartographic boundaries) · d3 (ISC license).

This is an independent research project. It is not affiliated with or endorsed by Kalshi, Polymarket, Reddit, Bluesky or any other source.
