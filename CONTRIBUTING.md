# Contributing / Local Development Setup

Quick guide for new teammates to get started.

## Prerequisites

- **Node.js** 20+ (recommend using [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm))
- **pnpm** 9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Docker** (for local database)

## Quick Start (5 minutes)

### 1. Clone and install

```bash
git clone <repo-url>
cd ilr-project
pnpm install
```

### 2. Start local database (auto-initializes)

```bash
docker compose up -d
```

This starts PostgreSQL on `localhost:5432` and **automatically**:
- Waits for database to be healthy
- Generates Prisma client
- Pushes schema to create tables

Check the init completed:
```bash
docker compose logs prisma-init
# Should see: ✅ Database initialized successfully
```

### 3. Start development servers

```bash
pnpm dev
```

This starts:
- **Frontend**: http://localhost:5173
- **API**: http://localhost:3001

That's it! The database is already configured for local development.

## Project Structure

```
ilr-project/
├── apps/
│   ├── api/        # Fastify backend
│   ├── frontend/   # React + Vite
│   └── worker/     # Playwright scraper (CLI)
├── packages/
│   ├── db/         # Prisma schema & client
│   └── shared/     # Shared types & utilities
└── docker-compose.yml
```

## Common Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all dev servers |
| `pnpm build` | Build all packages |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run TypeScript checks |
| `pnpm db:studio` | Open Prisma Studio (DB GUI) |
| `pnpm db:push` | Push schema to database |
| `pnpm db:migrate` | Run migrations |

## Working on Specific Apps

```bash
# Frontend only
pnpm --filter @ilr/frontend dev

# API only  
pnpm --filter @ilr/api dev

# Run scraper
pnpm --filter @ilr/worker start run
```

## Database

### Using Local Docker (Recommended for Dev)

```bash
docker compose up -d          # Start DB + auto-init
docker compose down           # Stop all
docker compose logs -f db     # View DB logs
docker compose logs prisma-init  # Check init status
```

### Running Services in Docker (Optional)

By default, you run `pnpm dev` natively for hot-reload. But you can also run services in Docker:

```bash
# Run API in container
docker compose --profile api up -d

# Run frontend in container
docker compose --profile frontend up -d

# Run scraper/worker
docker compose --profile worker up

# Run everything in containers
docker compose --profile api --profile frontend up -d

# pgAdmin (database GUI)
docker compose --profile tools up -d pgadmin
# Open http://localhost:5050 (admin@local.dev / admin)
```

### Using Supabase

If you prefer using Supabase directly:
1. Create a project at https://supabase.com
2. Get connection strings from Settings > Database
3. Update `.env` with Supabase URLs

### View Data

```bash
pnpm db:studio
```

Opens Prisma Studio at http://localhost:5555

## Testing the Scraper

```bash
# Test extraction logic
pnpm --filter @ilr/worker start test-extraction

# Run actual scrape (uses resume capability)
pnpm --filter @ilr/worker start run

# Full scrape from beginning
pnpm --filter @ilr/worker start run --no-resume
```

## Need Help?

- Check the main README.md for architecture overview
- Review existing code patterns in similar files
- Ask in the team channel
