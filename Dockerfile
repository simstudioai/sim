FROM node:20-alpine

# Set working directory
WORKDIR /app

# Set Node.js memory limit
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Copy package files
COPY sim/package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY sim/ ./

# Generate database schema
RUN npx drizzle-kit generate

# Build the application
RUN npm run build

EXPOSE 3000

# Run migrations and start the app
CMD npx drizzle-kit push --config=drizzle.config.ts && npm run start