/**
 * Container entrypoint. Hydrates `process.env` from the runtime secret before
 * loading the Socket.IO server, whose modules (`@/env`, DB preflight) read env
 * at import time. See `@sim/runtime-secrets`.
 */
import { createLogger } from '@sim/logger'
import { loadRuntimeSecrets } from '@sim/runtime-secrets'
import { distrustCompromisedRoots } from '@sim/security/tls-trust'

const tlsTrust = distrustCompromisedRoots()
await loadRuntimeSecrets()
const logger = createLogger('Bootstrap')
if (tlsTrust.unsupported || tlsTrust.error) {
  logger.error('Could not distrust compromised CA roots', tlsTrust)
} else if (tlsTrust.removed.length > 0) {
  logger.info('Distrusted compromised CA roots', { removed: tlsTrust.removed })
}
/**
 * Pin this process to the `realtime` DB role — covering both the realtime
 * `socketDb` pool and the shared `@sim/db` client used by handlers, preflight,
 * and permissions. The role drives the pool-size profile, `application_name`,
 * and the role-keyed connection URL, so every realtime connection resolves
 * consistently (without it the shared client would default to `web`). Set
 * before importing `@/index` so it lands before `@sim/db` reads it at
 * module-eval time; `??=` respects an explicit override.
 */
process.env.SIM_DB_ROLE ??= 'realtime'
process.env.DB_APP_NAME ??= 'sim-realtime'
await import('@/index')
