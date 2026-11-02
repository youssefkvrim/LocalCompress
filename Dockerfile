FROM registry.dev.apphub.safran/proxy_docker/library/node:24-alpine AS build

WORKDIR /app

# Internal PKI is handled by the host trust store (Node 22+).
ENV NODE_OPTIONS=--use-system-ca

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

FROM registry.dev.apphub.safran/proxy_docker/nginxinc/nginx-unprivileged:stable-alpine

COPY --from=build /app/dist /usr/share/nginx/html
RUN cat > /etc/nginx/conf.d/default.conf <<'EOF'
server {
	listen       8080;
	server_name  _;

	root   /usr/share/nginx/html;
	index  index.html;

	gzip on;
	gzip_vary on;
	gzip_comp_level 5;
	gzip_min_length 1024;
	gzip_types text/plain text/css application/javascript application/json application/manifest+json image/svg+xml;

	add_header Cross-Origin-Opener-Policy "same-origin" always;
	add_header Cross-Origin-Embedder-Policy "require-corp" always;
	add_header Cross-Origin-Resource-Policy "same-origin" always;
	add_header X-Content-Type-Options "nosniff" always;
	add_header Referrer-Policy "no-referrer" always;
	add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=()" always;
	add_header X-Frame-Options "DENY" always;
	add_header Content-Security-Policy "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self'; font-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types default; frame-ancestors 'none'" always;

	location ~* \.(js|css|wasm|woff2?|ttf|svg|png|ico|webmanifest|json|bcmap|pfb|onnx)$ {
		expires 1y;
		add_header Cache-Control "public, max-age=31536000, immutable" always;
		try_files $uri =404;
	}

	location = /index.html {
		add_header Cache-Control "no-store" always;
		try_files $uri =404;
	}

	location = /sw.js {
		add_header Cache-Control "no-store" always;
		try_files $uri =404;
	}

	location = /asset-manifest.json {
		add_header Cache-Control "no-store" always;
		try_files $uri =404;
	}

	location = /healthz {
		add_header Cache-Control "no-store" always;
		return 200 "ok\n";
	}

	location / {
		try_files $uri /index.html;
	}
}
EOF

EXPOSE 8080
