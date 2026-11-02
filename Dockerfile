FROM registry.dev.apphub.safran/proxy_docker/library/node:24-alpine AS build

WORKDIR /app

# Internal PKI is handled by the host trust store (Node 22+).
ENV NODE_OPTIONS=--use-system-ca

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

# "alpine-slim": nginx only, without curl/libcurl/brotli (most of the scan findings).
FROM registry.dev.apphub.safran/proxy_docker/nginxinc/nginx-unprivileged:stable-alpine-slim

# Security fixes released after the base image was built (zlib, musl...), from the
# internal Alpine mirror (the build machines have no Internet access). Its TLS
# certificate comes from the Safran PKI: the CA is trusted for this step only.
# Only done when the base image is on the mirror's Alpine branch, never mixed.
USER root
COPY deploy/certs/safran-ca.pem /tmp/safran-ca.pem
RUN set -eu; \
    . /etc/os-release; \
    branch="${VERSION_ID%.*}"; \
    mirror="https://artifacts.cloud.one.ad/repository/alpine-latest-stable"; \
    cp /etc/ssl/certs/ca-certificates.crt /tmp/ca.orig; \
    cat /tmp/safran-ca.pem >> /etc/ssl/certs/ca-certificates.crt; \
    printf '%s/main\n' "$mirror" > /tmp/repositories; \
    mirror_branch="$(wget -qO- "$mirror/releases/x86_64/latest-releases.yaml" | sed -n 's/^ *version: *\([0-9]*\.[0-9]*\).*/\1/p' | head -n 1)"; \
    if [ "$mirror_branch" = "$branch" ]; then \
      apk upgrade --no-cache --repositories-file /tmp/repositories; \
    else \
      echo "WARNING: base image is Alpine $branch, mirror is Alpine ${mirror_branch:-unknown}: packages NOT upgraded"; \
    fi; \
    # Back to the public CA list (unless apk just replaced it with a newer one).
    if grep -qF "$(sed -n 3p /tmp/safran-ca.pem)" /etc/ssl/certs/ca-certificates.crt; then cp /tmp/ca.orig /etc/ssl/certs/ca-certificates.crt; fi; \
    rm -f /tmp/safran-ca.pem /tmp/ca.orig /tmp/repositories; \
    apk info -v 2>/dev/null | grep -E '^(musl|zlib|curl|libcurl|brotli)' || true
USER 101

COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/localkit.nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
