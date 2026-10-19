.PHONY: help install dev backend frontend test test-backend test-frontend build docker-up docker-down migrate

help:
	@echo "FormRelay Development Commands:"
	@echo "  make install        Install backend and frontend dependencies"
	@echo "  make backend        Run FastAPI backend locally"
	@echo "  make frontend       Run Vite frontend dev server"
	@echo "  make test           Run both backend and frontend test suites"
	@echo "  make test-backend   Run backend pytest"
	@echo "  make test-frontend  Run frontend vitest"
	@echo "  make migrate        Run Alembic database migrations"
	@echo "  make docker-up      Start full stack via Docker Compose"
	@echo "  make docker-down    Stop Docker Compose containers"

install:
	cd backend && pip install -e .
	cd frontend && npm install

backend:
	cd backend && uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

migrate:
	cd backend && alembic upgrade head

test-backend:
	cd backend && pytest -v

test-frontend:
	cd frontend && npm test

test: test-backend test-frontend

build:
	cd frontend && npm run build

docker-up:
	docker compose up --build

docker-down:
	docker compose down -v
