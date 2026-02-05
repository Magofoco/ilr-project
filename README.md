# ILR Tracker

A production-ready MVP for tracking UK ILR (Indefinite Leave to Remain) waiting times by scraping public immigration forums and extracting structured data.

## Architecture

```
ilr-tracker/
├── apps/
│   ├── api/          # Fastify REST API
│   ├── frontend/     # Vite + React dashboard
│   └── worker/       # Playwright scraper + extraction
├── packages/
│   ├── db/           # Prisma schema + client
│   └── shared/       # Zod schemas + types
```

### Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces
- **Language**: TypeScript (ESM everywhere)
- **Database**: Supabase Postgres + Prisma 6.19.0
- **Auth**: Supabase Auth (email/password + OAuth-ready)
- **API**: Fastify with JWT verification
- **Frontend**: Vite + React + Tailwind + Shadcn
- **Scraping**: Playwright + Cheerio

## Prerequisites

- Node.js 20+
- pnpm 9+
- A Supabase project

## Quick Start

### 1. Clone and Install

```bash
git clone <repo-url>
cd ilr-tracker
pnpm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Project Settings > Database** and copy:
   - Connection string (pooler) → `DATABASE_URL`
   - Connection string (direct) → `DATABASE_DIRECT_URL`
3. Go to **Project Settings > API** and copy:
   - Project URL → `SUPABASE_URL`
   - anon public key → `SUPABASE_ANON_KEY`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY`
4. Go to **Project Settings > API > JWT Settings** and copy:
   - JWT Secret → `SUPABASE_JWT_SECRET`

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your Supabase credentials
```

### 4. Set Up Auth Redirects

In Supabase Dashboard > Authentication > URL Configuration:

- **Site URL**: `http://localhost:5173` (dev) or your production URL
- **Redirect URLs**: Add:
  - `http://localhost:5173/**`
  - `http://localhost:5173/auth/callback`
  - `https://your-domain.com/**` (production)

### 5. Generate Prisma Client & Run Migrations

```bash
# Generate Prisma client
pnpm db:generate

# Run migrations (creates tables in Supabase)
pnpm db:migrate
```

### 6. Start Development

```bash
# Run all apps in parallel
pnpm dev

# Or run individually:
pnpm api:dev      # API on http://localhost:3001
pnpm frontend:dev # Frontend on http://localhost:5173
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm dev` | Start all apps in dev mode |
| `pnpm build` | Build all apps |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:push` | Push schema changes (dev only) |
| `pnpm worker:run run --source=<name>` | Run scraper for a source |
| `pnpm worker:run scheduled` | Run scheduled scrape for all sources |
| `pnpm worker:run list-sources` | List configured sources |
| `pnpm type-check` | TypeScript type checking |

## Worker CLI

```bash
# Run scraper for a specific source
pnpm worker:run run --source=immigrationboards

# With options
pnpm worker:run run --source=immigrationboards --since=2024-01-01 --max-threads=10

# Dry run (no database writes)
pnpm worker:run run --source=immigrationboards --dry-run

# Run scheduled scrape for all active sources
pnpm worker:run scheduled

# List available sources
pnpm worker:run list-sources
```

## Adding a New Source

1. Create an adapter in `apps/worker/src/sources/`:

```typescript
// apps/worker/src/sources/my-forum.ts
import type { SourceForum } from '@ilr/db';
import type { SourceAdapter } from '@ilr/shared';

export function createMyForumAdapter(source: SourceForum): SourceAdapter {
  return {
    name: source.name,
    type: source.type as 'playwright' | 'fetch',
    
    async getThreads(options) {
      // Implement thread listing
    },
    
    async getPosts(thread) {
      // Implement post scraping
    },
  };
}
```

2. Register in `apps/worker/src/sources/index.ts`

3. Add source via Admin UI or API:

```bash
curl -X POST http://localhost:3001/admin/sources \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-forum",
    "displayName": "My Forum",
    "baseUrl": "https://example.com",
    "type": "playwright"
  }'
```

## Making a User Admin

1. Sign up a user through the UI
2. Get their Supabase user ID from the Supabase Dashboard (Authentication > Users)
3. Insert into user_roles table:

```sql
INSERT INTO user_roles (id, user_id, role)
VALUES (gen_random_uuid(), '<supabase-user-id>', 'admin');
```

## Deployment

### Recommended: Railway

Railway provides simple deployment with native cron support.

1. **Create Railway Project**
   ```bash
   # Install Railway CLI
   npm install -g @railway/cli
   railway login
   railway init
   ```

2. **Add Services**
   - Link your GitHub repo
   - Create two services from the same repo:
     - **API**: Set Dockerfile target to `api`
     - **Worker**: Set Dockerfile target to `worker` (or use GitHub Actions for cron)

3. **Set Environment Variables**
   In Railway dashboard, add all variables from `.env.example`

4. **Deploy**
   ```bash
   railway up
   ```

### Frontend: Cloudflare Pages

1. Connect your GitHub repo to Cloudflare Pages
2. Build settings:
   - **Build command**: `pnpm install && pnpm build`
   - **Build output**: `apps/frontend/dist`
   - **Root directory**: `/`
3. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_API_BASE_URL` (your Railway API URL)

### Worker Scheduling

**Option A: GitHub Actions (Recommended)**

Already configured in `.github/workflows/scheduled-scrape.yml`. Add secrets:
- `DATABASE_URL`
- `DATABASE_DIRECT_URL`

**Option B: Railway Cron**

Set the worker service to run on schedule via Railway's cron feature.

## API Endpoints

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/health/deep` | Deep health check (includes DB) |
| GET | `/stats/overview` | Overview statistics |
| GET | `/cases` | List cases with filters |
| GET | `/cases/:id` | Get single case |
| GET | `/cases/filters` | Get available filter options |

### Admin (requires auth + admin role)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/sources` | List all sources |
| POST | `/admin/sources` | Create source |
| PATCH | `/admin/sources/:id` | Update source |
| DELETE | `/admin/sources/:id` | Delete source |
| POST | `/admin/scrape/trigger` | Trigger scrape run |
| GET | `/admin/scrape/runs` | List scrape runs |

## Database Schema

- `source_forums` - Configured forum sources
- `threads` - Forum threads/topics
- `posts` - Individual posts (raw content)
- `extracted_cases` - Structured ILR data extracted from posts
- `scrape_runs` - Scrape job history
- `user_roles` - Admin role assignments

## Environment Variables

See `.env.example` for all required variables with documentation.

## License

MIT
