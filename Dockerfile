FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
RUN npm ci

# Copy everything else (for build)
COPY . .

EXPOSE 3000

# Default to development mode
CMD ["npm", "run", "dev"] 