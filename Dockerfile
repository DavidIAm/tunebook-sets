FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY web ./web
COPY data ./data

# writable dirs for the non-root user: thesession cache + legacy saved-sets file
RUN mkdir -p .cache && chown -R node:node /app
USER node

ENV PORT=3117 CACHE_DIR=/app/.cache
EXPOSE 3117
# mount a volume here to keep the polite thesession.org cache across restarts
VOLUME /app/.cache

CMD ["node", "src/server.js"]
