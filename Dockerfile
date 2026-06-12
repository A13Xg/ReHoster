FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data /app/logs /app/managed-apps

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["sh", "-lc", "node src/db/init.js && node src/server.js"]
