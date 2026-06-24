/**
 * Container entrypoint. Hydrates `process.env` from the runtime secret before
 * loading the Socket.IO server, whose modules (`@/env`, DB preflight) read env
 * at import time. See `@sim/runtime-secrets`.
 */
import { loadRuntimeSecrets } from '@sim/runtime-secrets'

await loadRuntimeSecrets()
await import('@/index')
