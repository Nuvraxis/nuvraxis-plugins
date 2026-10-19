# Local Postgres

## compose.yaml (template)

<!-- template: compose.yaml -->
```yaml
# Local PostgreSQL for development: `docker compose up -d`, then `pnpm db:migrate`.
# Production uses an external database; nothing here is deployed.
name: __APP__

services:
  postgres:
    # Postgres 17, pinned by digest (multi-arch index), the same image CI's pr.yaml uses.
    image: postgres:17.11-alpine3.24@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: __APP__
    ports:
      # Loopback only: not reachable from the network. Port taken? POSTGRES_PORT=55432 docker
      # compose up -d, and use that port in DATABASE_URL.
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d __APP__"]
      interval: 5s
      timeout: 5s
      retries: 10

  # Optional web UI: `docker compose --profile tools up -d`, then http://127.0.0.1:8080
  # (System: PostgreSQL, Server: postgres, user/password/database as above).
  adminer:
    image: adminer:5.5.1@sha256:e3a6b4942dd088a29cc8bbce22553429247c5c2b30b07d856ae49012b5c84a5b
    profiles: [tools]
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "127.0.0.1:8080:8080"

volumes:
  pgdata:
```

## .env.example (template)

<!-- template: .env.example -->
```sh
# Copy to .env for local development (`.env` is git-ignored). Matches compose.yaml.
# In Kubernetes DATABASE_URL comes from an existing Secret, never from a file.
DATABASE_URL=postgres://app:app@127.0.0.1:5432/__APP__
```

## Daily use

```sh
docker compose up -d --wait        # start, wait for the healthcheck
cp .env.example .env               # once
pnpm db:migrate                    # build the runner, apply migrations
pnpm db:seed                       # idempotent sample data
pnpm db:studio                     # browse (local only)
docker compose --profile tools up -d   # Adminer on http://127.0.0.1:8080
docker compose down                # stop, keep data
docker compose down -v             # stop and delete the volume (fresh database next time)
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Bind for 0.0.0.0:5432 failed: port is already allocated` | Another Postgres runs. `POSTGRES_PORT=55432 docker compose up -d` and put 55432 in `.env`'s `DATABASE_URL`. |
| `password authentication failed` after changing the compose password | The volume kept the old cluster: `docker compose down -v` (deletes local data). |
| `migrate: failed: … (cause: connect ECONNREFUSED …)` | Database not up, or `.env` points at the wrong port. |
| From a container, `127.0.0.1` doesn't reach Compose | Use `host.docker.internal` (Docker Desktop) in that container's `DATABASE_URL`. |

## The drizzle-kit MCP server (opt-in)

The fullstack scaffold adds it to `.mcp.json`, and disables it in `.claude/settings.json`:

```json
{
  "disabledMcpjsonServers": ["drizzle"]
}
```

`.mcp.json` must stay plain JSON: a single comment makes Claude Code reject the whole file, which would also drop the nuvui and next-devtools servers. That's why the server is disabled in settings rather than commented out.
