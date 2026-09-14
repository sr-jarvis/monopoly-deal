FROM node:22-alpine

RUN addgroup -g 1005 pirate && \
    adduser -D -H -u 1004 -G pirate pirate

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci --omit=dev --workspace=server

COPY server ./server
RUN chown -R pirate:pirate /app
USER pirate

ENV NODE_ENV=production
ENV PORT=9000
EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9000/api/monopoly/rooms || exit 1

CMD ["node", "server/app.js"]
