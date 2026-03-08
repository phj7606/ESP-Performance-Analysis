FROM node:20-alpine

WORKDIR /app

# Copy dependency files first (optimises layer caching)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
