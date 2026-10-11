# Ticket 01 backend and deployment evidence

Date: 2026-10-11. Integration target: `integration/nivli-v1`; implementation branch: `implement/nivli-01`.

## Verified locally

- Node 24.4.1; strict TypeScript build succeeds from a clean `npm ci`. Exact dependency versions are retained in package-lock.json. Installed Fastify/Swagger and pg-boss declarations plus official Fastify type-provider, Swagger and Drizzle transaction documentation were checked before using their APIs.
- PostgreSQL 17 container is real, not mocked. Nine Vitest HTTP cases use a fresh per-run database and actual listener. All nine pass. Cases cover metadata/unauthorized calls, pairing + retry + token rotation + revocation, concurrent consumption and primary replacement, code/token expiration, persistent rate limits after API restart, administrator code creation retries, log/input privacy, revoke replay/body conflict, reordered JSON retry bodies, and re-pairing after authenticated device logout. Setup privileges are separate from production assumptions.
- Initial HTTP tracer test was red because the application entry did not exist; subsequent mutation/revocation and administrator retry tests exposed failures before their fixes. Concurrency and expiration cases also verify already implemented transaction behavior. No claim is made that every assertion had its own isolated red run.
- Public OpenAPI regeneration and validation of the shared DTO examples succeed. Regeneration leaves committed contracts unchanged. The Swift consumer validates the same examples separately; see native evidence.
- Clean install/build/test/contract run and `git diff --check` passed after the idempotency review fix.
- Docker Compose ran a real linux/arm64 application build and PostgreSQL 17. Readiness returned 200 after migration. Database stop + API restart followed by database restart recovered readiness. Forced migration exit 73 prevented API/agent/delivery startup. Disposable Compose projects and their volumes were removed. Detailed local log: `/tmp/nivli-compose-check.log`; reproducible command: `BUILDX_BUILDER=desktop-linux deploy/check-compose.sh`.

## Scope and limits

API, agent, delivery and migration share one application image. Worker entries connect to real pg-boss and maintain heartbeats; reminder/model consumers belong to dependent tickets and are not advertised as available. No private user data or external model service was used. A separate temporary synthetic PostgreSQL fixture and HTTPS tunnel were made available only for native pairing acceptance, with credentials in a private temporary file.

GitHub Actions, multiarchitecture image publication, SBOM and vulnerability workflows are supplied but have not been executed remotely in this repository (no remote is configured). Linux/amd64 release evidence remains pending until publication. TLS proxy configuration is deployment-specific. Native signing, Keychain persistence, camera-denial/manual input and appearance evidence must be assessed from the native result rather than inferred from HTTP or Compose checks. The user waived accessibility as a completion gate for this implementation run; completed semantic UI improvements remain. Full v1, backups, APNs, notifications, Gmail and model processing remain outside this ticket's implemented pairing scope.

Primary documentation references: [Fastify type providers](https://fastify.dev/docs/latest/Reference/Type-Providers/), [fastify-swagger](https://github.com/fastify/fastify-swagger), [Drizzle transactions](https://orm.drizzle.team/docs/transactions), [pg-boss transaction adapters](https://pgboss.io/api/adapters).
