FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy the entire sim directory
COPY sim/ ./

# Create the .env file if it doesn't exist
RUN touch .env

# Install dependencies
RUN npm install

# Generate database schema
RUN npx drizzle-kit generate

EXPOSE 3000

# Run migrations and start the app
CMD npx drizzle-kit push && npm run dev