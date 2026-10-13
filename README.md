# [placeholder]

Paste a pump.fun contract address and see:

- **Bundled buys**: wallets that landed in the creation slot, bought for several wallets in one transaction, bought identical amounts, or paid Jito tips alongside the deploy.
- **Funding links**: where each early wallet got its SOL, grouped into clusters (including wallets tied back to the creator).
- **Hold times and positions**: for each early buyer, whether they're holding, sold, or moved tokens to another wallet, the token-weighted median hold time, and realized PnL.
- **Smart money**: every early buyer is rated from their recent trades (Smart, Profitable flipper, Bot-like, Losing, Unproven), so you can see whether proven wallets got in early and whether they're still holding.
- **Shared funding**: funders are traced one extra hop back, so wallets that look independent but trace to one source get grouped. Funders that bankrolled early buyers in other launches are flagged.
- **Smart wallets page** (`/smart`): a running leaderboard of profitable wallets and repeat funders, built from every lookup on the site.
- **Wallet history**: any wallet's recent trades across tokens, with win rate, realized PnL, median hold, rating, and where its SOL came from and went.

Everything is computed **on demand** when someone searches. There's no background indexer and no database to run. Results are cached, so a popular token costs the same as a quiet one.

---

## Quick start

```bash
cp .env.example .env.local   # then add your HELIUS_API_KEY
npm install
npm run dev                  # http://localhost:3000
```

You need a [Helius](https://dashboard.helius.dev) API key. The app relies on `getTransactionsForAddress`, a Helius-only RPC method that can return an address's history oldest-first. Check that your Helius plan includes it.

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, **Add New → Project**, import the repo. The Next.js preset is detected automatically.
3. Under **Environment Variables**, add `HELIUS_API_KEY`.
4. Deploy.
5. Recommended for production: in the Vercel dashboard go to **Storage → Marketplace → Upstash Redis**, create a database and connect it to the project. That sets `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_*`) and turns on the shared cache and rate limiting across all serverless instances. Redeploy after connecting.

Without Redis the app still works, using a per-instance in-memory cache.

## How a lookup works

```
/token/[ca]  ──►  GET /api/token/[ca]            launch analysis (1–2 RPC calls)
                    └─ getTransactionsForAddress(mint, asc, ~300 txs)
                    └─ getAsset(mint) for name / symbol / image / supply
                    └─ decode pump.fun TradeEvent / CreateEvent
                    └─ creator, dev buy, first N buyers, slot strip, launch signals

              ──►  GET /api/token/[ca]/wallets    early-wallet analysis (~3 calls per wallet)
                    for each early buyer, in parallel:
                    └─ funder: last SOL inflow ≥ 0.01 before the creation slot
                    └─ wallet age: first-ever transaction
                    └─ position: history of the wallet's associated token account
                       for this mint, FIFO-matched into hold times and PnL
                    └─ union-find clusters over funding edges (exchanges excluded)

              ──►  GET /api/token/[ca]/smart      trader ratings (1 call per wallet, cached 6h per wallet)
                    └─ each early buyer's last ~150 transactions → closed positions,
                       win rate, realized PnL, median hold → rating (src/lib/smart.ts)
                    └─ smart / profitable wallets are added to the leaderboard

/wallet/[addr] ──► GET /api/wallet/[addr]         profile (~3 calls)
                    └─ last ~500 transactions incl. token-account activity
                    └─ per-token FIFO positions + aggregate stats
```

The token page loads the launch analysis first (fast), then fills in funding and holdings as the second request finishes. The launch strip blocks change from gray to cluster colors when funding links arrive.

### Trade detection

- **pump.fun bonding-curve trades** are read from the program's own `TradeEvent` (from both self-CPI event instructions and `Program data:` logs, scoped to the pump.fun program). These give exact SOL and token amounts.
- **Trades elsewhere** (PumpSwap after graduation, Jupiter, Raydium, bots) are inferred from balance changes: a signer whose token balance went up while their SOL/WSOL went down by more than 0.003 SOL bought, and vice versa.
- **Anything else** that moves tokens is a transfer. Transfers close lots for hold-time purposes but don't count toward PnL, and the counterparty is recorded so consolidation into one wallet can be flagged.

### Smart-wallet rules

All thresholds live in `SMART_RULES` in `src/lib/smart.ts`:

| Label | Rule (from recent closed positions) |
| --- | --- |
| Unproven | Fewer than 5 closed positions |
| Losing | Realized PnL ≤ 0, or win rate under 35% |
| Bot-like | Profitable, but median hold under 60s across 10+ trades |
| Smart | Win rate ≥ 50%, ≥ 1 SOL realized, median hold ≥ 30 min |
| Profitable flipper | Profitable but doesn't meet the Smart bar |

The 0–100 score weighs win rate (40), realized profit on a log scale (30), hold time (20) and sample size (10). Ratings reflect a wallet's recent history only, not its lifetime.

### Leaderboard and repeat funders

The `/smart` page and the "Seen in N other launches" flags come from a registry in `src/lib/registry.ts`. It's built up from every lookup, so it starts empty and grows as people use the site. It needs Upstash Redis to persist; without it, it lives in memory per server instance and resets on each deploy.

### Caching

| Data | Redis TTL | CDN (`s-maxage`) |
| --- | --- | --- |
| Launch analysis, token < 2 min old | 15 s | 15 s |
| Launch analysis, token < 1 h old | 5 min | 5 min |
| Launch analysis, older | 14 days (launch history never changes) | 1 h |
| Early wallets (positions change) | 2 min | 1 min |
| Wallet profile | 10 min | 5 min |

Bump `V` in `src/lib/service.ts` to invalidate everything after changing analysis logic. Concurrent requests for the same key on one instance share a single computation. Rate limiting (`RATE_LIMIT_PER_MINUTE`, default 20 per IP) applies only to cache misses.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `HELIUS_API_KEY` | required | Helius mainnet key |
| `HELIUS_RPC_URL` | | Full RPC URL override (e.g. a dedicated node) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | | Shared cache + rate limit |
| `EARLY_BUYER_LIMIT` | 30 | Early buyers to profile. Each costs ~3 calls |
| `LAUNCH_TX_LIMIT` | 300 | Earliest mint transactions to scan (max 1000) |
| `HELIUS_CONCURRENCY` | 6 | Parallel Helius requests per instance |
| `HELIUS_RPS` | 10 | RPC requests per second per instance. Keep under your plan's limit |
| `HELIUS_DAS_RPS` | 4 | `getAsset` requests per second per instance |
| `RATE_LIMIT_PER_MINUTE` | 30 | Fresh analyses per IP per minute (a token page uses up to 3) |
| `SMART_TX_LIMIT` | 150 | Recent transactions scanned per wallet when rating traders |
| `SECOND_HOP_LIMIT` | 12 | Funders traced one more hop back per token |

Exchange hot wallets in `src/lib/solana/constants.ts` (`KNOWN_FUNDERS`) are excluded from clustering so that unrelated people withdrawing from the same exchange aren't linked. Verify and extend that list; it's the biggest lever on false positives.

## Project layout

```
src/
  app/
    page.tsx                      home + search
    token/[ca]/page.tsx           token page
    wallet/[address]/page.tsx     wallet page
    api/token/[ca]/route.ts       launch analysis
    api/token/[ca]/wallets/route.ts
    api/wallet/[address]/route.ts
  components/                     TokenView, WalletView, SearchBox, Addr
  lib/
    analysis/launch.ts            creation, early buyers, bundle signals
    analysis/wallets.ts           funding, clusters, positions
    analysis/profile.ts           cross-token wallet history
    solana/pump.ts                pump.fun event decoding
    solana/tx.ts                  activity extraction from parsed transactions
    solana/helius.ts              RPC client: retries, concurrency, pagination
    fifo.ts                       lot matching, hold times, PnL
    cache.ts  ratelimit.ts  score.ts  types.ts
```

## Scaling path

The current design handles a lot of traffic as-is because results are cached at two layers (Redis and Vercel's CDN). When you outgrow it:

1. **Raise limits first.** Upgrade the Helius plan, raise `HELIUS_CONCURRENCY`, and set `maxDuration` higher in the API routes if you're on Vercel Pro.
2. **Persist results.** Swap the Redis cache for Postgres (Neon or Supabase from the Vercel Marketplace) storing launches, trades and funding edges. Funding edges and launch windows never change, so they can be shared across tokens: a wallet traced once doesn't need tracing again.
3. **Move heavy work off the request path.** Put early-wallet analysis on a queue (Upstash QStash, Inngest, or a worker on Railway/Fly) and have the page poll for results.
4. **Add live capture for hot tokens.** A small always-on worker subscribed to PumpPortal or Helius gRPC can record launches the moment they happen, so first lookups are instant and nothing is lost on very busy tokens.

## Caveats

These are heuristics. A creation-slot buy can be a fast sniper rather than the deployer; a shared funder can be an OTC desk or a service. The UI shows the evidence and links to transactions so people can judge for themselves. Positions are reconstructed from each wallet's associated token account, so tokens held in non-standard accounts won't appear. Wallet profiles cover recent history only.
