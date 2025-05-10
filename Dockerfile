FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy the entire monorepo
COPY . ./

# Create the .env file if it doesn't exist
RUN touch apps/sim/.env

# Install dependencies for the monorepo
RUN npm install

# Install Turbo globally
RUN npm install -g turbo

# Generate database schema for sim app
RUN cd apps/sim && npx drizzle-kit generate

EXPOSE 3000

# Run migrations and start the app
CMD cd apps/sim && npx drizzle-kit push && cd ../.. && npm run dev