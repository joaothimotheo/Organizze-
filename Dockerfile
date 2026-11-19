# Imagem única: front-end compilado + API em Rust. Usada pelo Render (render.yaml).

FROM node:22-slim AS front
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM rust:1-slim-bookworm AS back
WORKDIR /app/backend
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src
# Poucos jobs em paralelo para caber na memória do build gratuito.
RUN cargo build --release --locked -j 2

# TLS (Neon e Banco Central) usa os certificados embutidos no binário (rustls + webpki-roots).
FROM debian:bookworm-slim
RUN useradd --system --uid 10001 app
WORKDIR /app
COPY --from=back /app/backend/target/release/financeiro-api ./financeiro-api
COPY --from=front /app/frontend/dist ./frontend/dist
USER app
ENV FINANCEIRO_FRONTEND=/app/frontend/dist \
    RUST_LOG=info,tower_http=warn,pdf_extract=error
EXPOSE 10000
CMD ["./financeiro-api"]
