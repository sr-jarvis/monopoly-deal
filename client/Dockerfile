FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
COPY shared ./shared
RUN npm ci

COPY client ./client
ARG APP_REVISION=development
RUN npm run build:client && printf '%s\n' "$APP_REVISION" > client/dist/revision.txt

FROM nginxinc/nginx-unprivileged:alpine
ARG APP_REVISION=development
LABEL org.opencontainers.image.revision=$APP_REVISION
COPY --from=builder /app/client/dist /usr/share/nginx/html
COPY --chmod=644 client/nginx.conf /etc/nginx/nginx.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
