FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy the entire sim directory
COPY sim/ ./

# Install dependencies
RUN npm install

# Generate database schema
RUN npx drizzle-kit generate

EXPOSE 3000

# Run migrations and start the app
CMD npx drizzle-kit push && npm run dev