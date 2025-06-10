FROM oven/bun:alpine AS base

WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN mkdir -p apps
COPY apps/sim/package.json ./apps/sim/package.json

# Install all dependencies (including dev dependencies for development)
RUN bun install

# Copy source code
COPY . .

# Install sharp for Next.js image optimization
WORKDIR /app/apps/sim
RUN bun install sharp

# Set development environment
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
ENV VERCEL_TELEMETRY_DISABLED=1

# Expose port
EXPOSE 3000

# Go back to root and start development server
WORKDIR /app
CMD ["bun", "run", "dev"] 