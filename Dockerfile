FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy the entire sim directory
COPY sim/ ./

# Install dependencies
RUN npm install

EXPOSE 3000

# Default to development mode
CMD ["npm", "run", "dev"]