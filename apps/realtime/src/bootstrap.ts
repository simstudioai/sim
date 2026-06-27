/**
 * Container entrypoint. Hydrates `process.env` from the runtime secret before
 * loading the Socket.IO server, whose modules (`@/env`, DB preflight) read env
 * at import time. See `@sim/runtime-secrets`.
 */
import { loadRuntimeSecrets } from '@sim/runtime-secrets'

await loadRuntimeSecrets()
/**
 * Label every Postgres connection this process opens as `sim-realtime` — both
 * the realtime `socketDb` pool and the shared `@sim/db` client used by handlers,
 * preflight, and permissions. Set before importing `@/index` so it lands before
 * `@sim/db` reads it at module-eval time. `??=` respects an explicit override.
 */
process.env.DB_APP_NAME ??= 'sim-realtime'
await import('@/index')
