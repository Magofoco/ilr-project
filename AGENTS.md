# ILR Tracker — project context

You are helping me build **ILR Tracker**, a UK-immigration product. Read this whole document before doing anything else.

## What is ILR

**Indefinite Leave to Remain (ILR)** is the UK immigration status that grants permanent residency to a non-citizen. Applicants submit an online application to the Home Office, attend a biometrics appointment at a UKVCAS centre, and wait for a decision. The official "service standard" is 6 months but is routinely missed. Wait times vary widely by route, nationality, biometrics location, and service tier (Standard / Priority / Super Priority).

## The product

A web app that turns scattered forum reports into a personalized, calibrated waiting-time estimate. A logged-in user enters their nationality, route, biometrics location, service tier, and (optionally) application date, and the app returns:

- Median wait + P10/P25/P75/P90 from a Kaplan–Meier survival curve over comparable cases
- Approval rate among decided cases
- A "where am I right now" conditional view: "you're at day 73 — X% of comparable cases had a decision by now; conditional median remaining wait is Y days"
- A list of 20 anonymized comparable cases with source URLs (no usernames)
- An honest cohort-relaxation chain when the exact cohort is too small ("dropped: biometricsLocation, serviceTier")
- Disclaimers about forum-sample bias

The data is **right-censored**: pending cases are not failures, they're informative observations. Always treat them as censored, never silently drop them.

## Tech stack

- pnpm workspace monorepo
- Postgres via **Supabase** (Prisma; the schema is the source of truth — `pnpm --filter @ilr/db run db:push` applies changes; there are no tracked migrations)
- **Fastify** API with Supabase JWT auth (`apps/api`)
- **Playwright** scraper for `immigrationboards.com` phpBB threads (`apps/worker`)
- **Vite + React + TanStack Query + shadcn/ui** frontend (`apps/frontend`)
- **Zod** schemas in a shared package (`packages/shared`)
- TypeScript everywhere; ESM; Node 22

## Workspace layout

```
apps/
  api/         Fastify API (routes: /health, /stats/overview, /cases, /cases/filters, /cases/:id, POST /estimate, /admin/*)
  worker/      Scraper + extractor CLI (commands: run, list-sources, scheduled, reextract)
  frontend/    React app
packages/
  db/          Prisma client + schema
  shared/      Zod schemas, TS types, utils (incl. Kaplan–Meier, nationality normalization)
```

Key files: `packages/db/prisma/schema.prisma`, `apps/worker/src/extraction/extractor.ts` (current version `1.5`), `apps/worker/src/extraction/persistence.ts` (shared upsert payload — undefined→null coercion lives here), `apps/worker/src/scraper/runner.ts`, `apps/worker/src/sources/immigration-boards.ts`, `apps/api/src/lib/cohort.ts`, `apps/api/src/routes/estimate.ts`, `packages/shared/src/utils/kaplan-meier.ts`.

## Data model (current)

- `SourceForum → Thread → Post → ExtractedCase`
- `ExtractedCase` carries the flat snapshot: `applicationType`, `applicationRoute`, `serviceTier` (`standard | priority | super_priority`), `applicationDate`, `biometricsDate`, `docsRequestedDate`, `docsSubmittedDate`, `decisionDate`, `waitingDays`, `biometricsLocation`, `decisionCenter`, `applicantNationality`, `applicantNationalityCode` (ISO-3166 alpha-2), `outcome`, `isPending`, `confidence`, `extractorVersion`.
- `CaseEvent` is the milestone stream: one row per `(case, type, date)` where `type ∈ { applied, biometrics, acknowledgement, docs_requested, docs_submitted, decision }`. Re-extraction wipes a case's events and re-creates them — events are always consistent with the latest extractor version.

## Pipeline

1. **Scrape**: `apps/worker` Playwright scraper against the immigrationboards.com ILR timelines thread. Resume capable, dedupes via content hash.
2. **Extract**: `extractor.ts` v1.3 — regex-based; emits both flat snapshot fields and `events: ExtractedEvent[]`. Confidence threshold 0.3 to persist. Recognizes routes: SET(O), SET(M), SET(F), 10-year, BN(O), Skilled Worker, Global Talent, Tier 1 Entrepreneur, Tier 2, Spouse, Dependant. Captures biometrics city in parens. UTC date parsing, UK-first DD/MM/YYYY.
3. **Backfill**: `pnpm --filter @ilr/worker run start reextract --version-below 1.3` re-runs the extractor on existing posts without re-scraping.
4. **Estimator**: `apps/api/src/routes/estimate.ts` calls the cohort helper, runs Kaplan–Meier, relaxes filters in this order if the cohort is below `minCohortSize` (default 30): `biometricsLocation → serviceTier → applicantNationalityCode → applicationRoute`.

## Statistical principles to preserve

- **Always** use Kaplan–Meier (`@ilr/shared`'s `kaplanMeier`) for any wait-time median / percentile / "decided by now" computation. Never compute medians by filtering pending cases out.
- **Default cohort window**: last 730 days (Brexit/COVID-era cases are too different).
- **Service tier**: by default the estimator does NOT auto-include super-priority cases unless the user opts in — they would wreck the median.
- **Approval rate**: reported only when ≥10 decided cases. Forum-self-reported, biased.
- **k-anonymity**: never expose comparable-cases lists smaller than ~5 to a logged-in user.
- **Calibration**: when shown, compare our cohort median to public Home Office FOI/transparency stats so the user can sanity-check.

## Constraints I care about

- **Not immigration advice.** UI and ToS must say so. We report waiting-time statistics, never recommendations.
- **Privacy/GDPR.** No forum usernames anywhere. Source URL only. Lawful basis: legitimate interest. Have a takedown mechanism.
- **Forum ToS.** Be respectful; rate-limit; link back; don't republish full post text where avoidable.
- **Honesty over optimism.** The product's USP is calibrated honesty about uncertainty. Never paper over small cohorts, never hide that the data is biased.

## Pricing direction

B2C: **£29 one-off ("until your decision")** with a free tier (cohort median + 5 sample cases). Frame against the £3,029 application fee. Optional £4.99/mo to keep it active through FLR/naturalisation.
B2B (later): **£49–£199/mo** dashboard/API for immigration solicitors.

## How I want you to work

- Act like the best software engineer on the planet. Honest, careful, no flattery.
- **If unsure, ask.** Don't guess at destructive operations (DB migrations, deletions, force-pushes). I'd rather answer one question than fix a mistake.
- **Don't lie.** If a test is failing, say so. If you can't tell whether something works, say so. If you didn't actually verify, say so.
- Output may be reviewed by humans and AIs; aim for code that's clean enough either reviewer would approve.
- Prefer editing existing files over creating new ones. Don't add code comments that just narrate what the code does — only explain non-obvious intent.
- Use TodoWrite for multi-step tasks. Run typechecks and tests after substantive edits.
- When proposing changes, give me your plan first if it's non-trivial; let me confirm before you apply destructive operations.

## Status (update at the end of every session)

- Schema v2 + extractor v1.3 + KM-based estimator + `POST /estimate` route + frontend rename — all done, all typechecks pass (5 workspaces), extractor + KM unit tests pass.
- DB push has NOT been applied yet (user applies manually).
- Frontend Estimator page (consuming `POST /estimate` with chart + conditional panel + comparable cases) is the natural next slice but not built.
- Re-extraction backfill of existing posts has NOT been run yet.

When you start: confirm you've read this, then ask what I want to work on.
