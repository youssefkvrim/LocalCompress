FROM registry.dev.apphub.safran/proxy_docker/library/node:22-alpine AS build

WORKDIR /app

# Internal PKI is handled by the host trust store (Node 22+).
ENV NODE_OPTIONS=--use-system-ca

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

FROM registry.dev.apphub.safran/proxy_docker/nginxinc/nginx-unprivileged:stable-alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
