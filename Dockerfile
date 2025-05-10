# Use the latest Bun canary image for access to latest features and performance improvements
FROM oven/bun:canary AS base

# Set working directory inside the container
WORKDIR /app

# Install global CLI tools for monorepo management
RUN bun install -g turbo drizzle-kit

# Pre-copy lockfiles and monorepo config to leverage Docker layer caching during dependency resolution
COPY package.json bun.lockb turbo.json ./

# Prepare directory structure for scoped dependency installs
RUN mkdir -p apps packages

# Copy only the relevant package manifests to enable selective installation and caching
COPY apps/*/package.json ./apps/
COPY packages/*/package.json ./packages/

# Install dependencies for the monorepo. This step benefits from above caching strategy.
RUN bun install

# Copy the rest of the codebase into the container
COPY . .

# Create the .env file if it doesn't exist for apps/sim
RUN touch apps/sim/.env

# Generate database schema for sim app
RUN cd apps/sim && bunx drizzle-kit generate

# Build all apps/packages via defined turbo pipeline
RUN bun run build

# Use a smaller, stable Bun Alpine image for the production stage to minimize final image size
FROM oven/bun:alpine AS production

# Set working directory in production image
WORKDIR /app

# Copy fully built app from build stage
COPY --from=base /app /app
# Ensure bun packages are preserved
COPY --from=base /root/.bun /root/.bun

# Set production environment variables
ENV NODE_ENV=production
ENV BUN_INSTALL_CACHE_DIR=/root/.bun/cache

# Expose application port
EXPOSE 3000

# Run migrations and start the app
CMD cd apps/sim && bunx drizzle-kit push && cd ../.. && bun run start