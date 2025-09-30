FROM ghcr.io/simstudioai/migrations:latest
WORKDIR /app/packages/db

# Copy only package files needed for migrations
COPY package.json bun.lock turbo.json ./
COPY packages/db/package.json ./packages/db/package.json

# Install dependencies
RUN bun install --ignore-scripts

# Copy only the necessary files from deps
COPY --from=deps /app/node_modules ./node_modules
COPY packages/db/drizzle.config.ts ./packages/db/drizzle.config.ts
COPY packages/db/drizzle.config.ts ./packages/db

CMD ["bun", "run", "db:migrate"]