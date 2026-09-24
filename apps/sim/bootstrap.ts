/**
 * Container entrypoint. Hydrates `process.env` from the runtime secret before
 * loading the Next.js standalone server, so application modules that read env at
 * import time see the full configuration. See `@sim/runtime-secrets`.
 */
import { loadRuntimeSecrets } from '@sim/runtime-secrets'

await loadRuntimeSecrets()
// Explicit runtime configuration wins over deployment defaults.
process.env.MSHIP_PLAN_MODE ??=
  process.env.MSHIP_PLAN_MODE_DEFAULT ?? (process.env.NODE_ENV === 'development' ? 'true' : 'false')
process.env.SIM_SEARCH_LIVE ??= process.env.SIM_SEARCH_LIVE_DEFAULT ?? 'true'
process.env.NEXT_PUBLIC_SIM_SEARCH_LIVE = process.env.SIM_SEARCH_LIVE
// `server.js` is the Next standalone build artifact, a sibling of this file in
// the image; it does not exist at type-check time, so the specifier is held in a
// variable to keep it out of static module resolution.
const standaloneServer = './server.js'
await import(standaloneServer)
