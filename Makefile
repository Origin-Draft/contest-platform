SHELL := /bin/bash
PNPM := pnpm
DOCKER_COMPOSE := docker compose -f infra/docker-compose.yml

.PHONY: help env-demo env-dev env-production infra-up infra-down demo dev production \
        migrate health smoke-test backup restore logs

help:
	@echo "Available targets:"
	@echo "  make env-demo        # copy .env.demo.example to .env"
	@echo "  make env-dev         # copy .env.dev.example to .env"
	@echo "  make env-production  # copy .env.production.example to .env"
	@echo "  make infra-up        # start postgres and keycloak"
	@echo "  make infra-down      # stop the container stack"
	@echo "  make demo            # demo mode: dev-session bypass + local services"
	@echo "  make dev             # development mode: local Keycloak sign-in"
	@echo "  make production      # build and deploy via docker compose"
	@echo "  make migrate         # run drizzle migrations against the running DB"
	@echo "  make health          # check API /api/health and /api/ready"
	@echo "  make smoke-test      # quick production smoke test"
	@echo "  make backup          # backup databases and uploads"
	@echo "  make restore DIR=... # restore from a backup directory"
	@echo "  make logs            # tail all container logs"

env-demo:
	@[ ! -f .env ] || { echo "Error: .env already exists. Remove it first or use 'cp' manually."; exit 1; }
	cp .env.demo.example .env
	@echo "Copied .env.demo.example -> .env"

env-dev:
	@[ ! -f .env ] || { echo "Error: .env already exists. Remove it first or use 'cp' manually."; exit 1; }
	cp .env.dev.example .env
	@echo "Copied .env.dev.example -> .env"

env-production:
	@[ ! -f .env ] || { echo "Error: .env already exists. Remove it first or use 'cp' manually."; exit 1; }
	cp .env.production.example .env
	@echo "Copied .env.production.example -> .env"

infra-up:
	$(DOCKER_COMPOSE) up -d postgres keycloak

infra-down:
	$(DOCKER_COMPOSE) down

demo: env-demo infra-up
	$(PNPM) dev

dev: env-dev infra-up
	$(PNPM) dev

production: env-production
	$(DOCKER_COMPOSE) up -d --build

deploy:
	$(DOCKER_COMPOSE) up -d --build

migrate:
	@echo "Schema is managed by bootstrap SQL in apps/api/src/db/client.ts."
	@echo "Changes are applied automatically on API startup (CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN IF NOT EXISTS)."
	@echo "For manual schema changes, edit the bootstrapSql block and restart the API."

health:
	@echo "==> /api/health"
	@curl -sf http://localhost:$${API_PORT:-4000}/api/health | jq .
	@echo ""
	@echo "==> /api/ready"
	@curl -sf http://localhost:$${API_PORT:-4000}/api/ready | jq .

smoke-test:
	@echo "==> Health check"
	@curl -sf http://localhost:$${API_PORT:-4000}/api/health > /dev/null && echo "  ✓ /api/health"
	@curl -sf http://localhost:$${API_PORT:-4000}/api/ready > /dev/null && echo "  ✓ /api/ready"
	@echo "==> Session config"
	@curl -sf http://localhost:$${API_PORT:-4000}/api/session/config > /dev/null && echo "  ✓ /api/session/config"
	@echo "==> Contest listing"
	@curl -sf http://localhost:$${API_PORT:-4000}/api/contests > /dev/null && echo "  ✓ /api/contests"
	@echo "==> All smoke tests passed"

backup:
	./infra/backup.sh

restore:
	@test -n "$(DIR)" || (echo "Usage: make restore DIR=infra/backups/20250101-120000" && exit 1)
	./infra/restore.sh $(DIR)

logs:
	$(DOCKER_COMPOSE) logs -f --tail=100
