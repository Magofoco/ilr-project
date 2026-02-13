#!/bin/bash
# Local development setup script
# Usage: ./scripts/setup-local.sh

set -e

echo "🚀 Setting up ILR Project for local development..."

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required but not installed."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "❌ pnpm is required. Run: corepack enable && corepack prepare pnpm@latest --activate"; exit 1; }

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
    
    # Replace with local Docker database URLs
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' 's|DATABASE_URL=.*|DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ilr_dev"|' .env
        sed -i '' 's|DATABASE_DIRECT_URL=.*|DATABASE_DIRECT_URL="postgresql://postgres:postgres@localhost:5432/ilr_dev"|' .env
    else
        # Linux
        sed -i 's|DATABASE_URL=.*|DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ilr_dev"|' .env
        sed -i 's|DATABASE_DIRECT_URL=.*|DATABASE_DIRECT_URL="postgresql://postgres:postgres@localhost:5432/ilr_dev"|' .env
    fi
    echo "✅ .env created with local database config"
else
    echo "⚠️  .env already exists, skipping..."
fi

# Start Docker containers
echo "🐳 Starting Docker containers..."
docker compose up -d

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
sleep 3

# Check database health
until docker compose exec -T db pg_isready -U postgres > /dev/null 2>&1; do
    echo "   Database is starting up..."
    sleep 2
done
echo "✅ Database is ready"

# Generate Prisma client and push schema
echo "🗄️  Setting up database schema..."
pnpm db:generate
pnpm db:push

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Run 'pnpm dev' to start development servers"
echo "  2. Open http://localhost:5173 for frontend"
echo "  3. API runs at http://localhost:3001"
echo ""
echo "Useful commands:"
echo "  pnpm db:studio  - Open database GUI"
echo "  pnpm lint       - Run linter"
echo "  pnpm build      - Build all packages"
