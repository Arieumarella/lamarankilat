# ---- deps stage: prebuilt better-sqlite3 (glibc/arm64) tanpa kompilasi ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
COPY package.json ./
# optionalDependencies (baileys) diizinkan ada; npm install tetap jalan walau optional gagal
RUN npm install --omit=dev --no-audit --no-fund

# ---- runtime stage ----
FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates fonts-noto-core gosu \
 && rm -rf /var/lib/apt/lists/* \
 && ln -snf /usr/share/zoneinfo/Asia/Jakarta /etc/localtime \
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
COPY docker-entrypoint.sh ./
RUN mkdir -p /app/data/db /app/data/artefacts /app/data/media /app/data/wa /app/data/logs \
 && chmod +x /app/docker-entrypoint.sh
EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node scripts/healthcheck.js
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
