#!/bin/bash

# Generate migrations using Drizzle
echo "Generating database migrations..."
docker compose exec simstudio npm run db:push

echo "Migrations generated successfully." 