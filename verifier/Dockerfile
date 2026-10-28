# Docmac Verifier Container
# Containerized apksigner, aapt2, ClamAV, and Node.js verification daemon
# Fulfills Section 8 of docs/BACKEND_ARCHITECTURE.md

FROM eclipse-temurin:17-jre-jammy AS base

# Install required build-tools (apksigner, aapt), ClamAV antivirus, and Node.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    apksigner \
    aapt \
    clamav \
    clamav-daemon \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Update virus definition baseline
RUN freshclam || true

WORKDIR /app

# Copy verifier service
COPY verifier/package.json ./verifier/
COPY verifier/server.mjs ./verifier/
COPY backend/src/verifier.ts ./backend/src/

WORKDIR /app/verifier

EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "server.mjs"]

