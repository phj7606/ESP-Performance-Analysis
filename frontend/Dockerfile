FROM node:20-alpine

WORKDIR /app

# 의존성 파일 먼저 복사 (레이어 캐시 최적화)
COPY package*.json ./
RUN npm ci

# 소스 복사
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
