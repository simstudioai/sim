FROM node:20-alpine

WORKDIR /app

# Copy package files from sim directory
COPY sim/package.json sim/package-lock.json ./
RUN npm ci

# Copy sim directory contents
COPY sim/ ./

EXPOSE 3000

# Default to development mode
CMD ["npm", "run", "dev"] 