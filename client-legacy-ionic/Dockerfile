# ---- Stage 1: builder ----
FROM node:10-alpine AS builder

# node-sass@4.9.0 (transitive Ionic dep) has no prebuilt musl binary for
# this Node/Alpine combo — it compiles from source via node-gyp.
RUN apk add --no-cache python2 make g++ git

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Stage 2: production ----
FROM nginx:1.27-alpine AS production

RUN addgroup -g 1005 pirate && \
    adduser -D -H -u 1004 -G pirate pirate && \
    rm -f /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /app/www /usr/share/nginx/html
RUN chown -R pirate:pirate /usr/share/nginx/html

USER pirate
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
