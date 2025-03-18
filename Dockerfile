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

# Create a startup script that will run migrations and then start the app
RUN echo '#!/bin/sh\nnpx drizzle-kit push\nexec "$@"' > /app/docker-entrypoint.sh && \
    chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Default to development mode
CMD ["npm", "run", "dev"]