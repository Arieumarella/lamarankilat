# ---- build stage: native modules (better-sqlite3) ----
FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json ./
# optionalDependencies (baileys) boleh gagal tanpa menggagalkan build
RUN npm install --omit=dev --no-audit --no-fund

# ---- runtime stage ----
FROM node:20-alpine
RUN apk add --no-cache tzdata font-noto su-exec ca-certificates \
 && cp /usr/share/zoneinfo/Asia/Jakarta /etc/localtime \
 && echo "Asia/Jakarta" > /etc/timezone
ENV TZ=Asia/Jakarta \
    NODE_ENV=production \
    PORT=8092 \
    NODE_OPTIONS=--max-old-space-size=192
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY migrations ./migrations
COPY scripts ./scripts
COPY tests ./tests
COPY docker-entrypoint.sh ./
RUN mkdir -p /app/data/db /app/data/artefacts /app/data/media /app/data/wa /app/data/logs \
 && chmod +x /app/docker-entrypoint.sh
EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node scripts/healthcheck.js
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
