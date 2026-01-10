FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Expose port
EXPOSE 3000

# Start the router
CMD ["node", "dist/index.js"]
