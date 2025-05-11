# Use the latest Bun canary image for access to latest features and performance improvements
FROM oven/bun:canary AS base

# Set working directory inside the container
WORKDIR /app

# Install global CLI tools for monorepo management and frontend framework
RUN bun install -g next turbo

# Pre-copy lockfiles and monorepo config to leverage Docker layer caching during dependency resolution
COPY package.json bun.lock turbo.json ./

# Prepare directory structure for scoped dependency installs
RUN mkdir -p apps

# Copy only the relevant package manifests to enable selective installation and caching
COPY apps/*/package.json ./apps/

# Install dependencies for the monorepo. This step benefits from above caching strategy.
RUN bun install

# Copy the rest of the codebase into the container
COPY . .

# Run `bun install` again in case any additional dependencies are introduced after full source copy
RUN bun install

# Build all apps/packages via defined turbo pipeline
RUN bun run build

# Use a smaller, stable Bun Alpine image for the production stage to minimize final image size
FROM oven/bun:1.2.11-alpine AS production

# Set working directory in production image
WORKDIR /app

# Copy fully built app from build stage
COPY --from=base /app /app

# Set production environment variables
ENV NODE_ENV=production
ENV NODE_OPTIONS=--no-experimental-fetch 

# Add custom entrypoint script and ensure it is executable
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Expose application port
EXPOSE 3000

# Define container entrypoint script (e.g., to run DB migrations, start server, etc.)
ENTRYPOINT ["/app/docker-entrypoint.sh"]