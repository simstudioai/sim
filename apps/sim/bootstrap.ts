/**
 * Container entrypoint. Hydrates `process.env` from the runtime secret before
 * loading the Next.js standalone server, so application modules that read env at
 * import time see the full configuration. See `@sim/runtime-secrets`.
 */
import { loadRuntimeSecrets } from '@sim/runtime-secrets'

await loadRuntimeSecrets()

/**
 * Chat cannot reach the mothership without `COPILOT_API_KEY`, so serving the
 * module with the key missing yields a UI where every message 401s. Fail the
 * deploy instead. Mirrors `isTruthy` from `lib/core/config/env.ts`, inlined
 * because this file is bundled separately for the container entrypoint and must
 * not pull the Next-only env module into its graph.
 */
const chatEnabled = process.env.CHAT_ENABLED?.toLowerCase()
if ((chatEnabled === 'true' || chatEnabled === '1') && !process.env.COPILOT_API_KEY) {
  throw new Error(
    'CHAT_ENABLED is set without COPILOT_API_KEY — Chat would render against a backend that rejects every request. Set COPILOT_API_KEY, or unset CHAT_ENABLED and NEXT_PUBLIC_CHAT_ENABLED.'
  )
}
// `server.js` is the Next standalone build artifact, a sibling of this file in
// the image; it does not exist at type-check time, so the specifier is held in a
// variable to keep it out of static module resolution.
const standaloneServer = './server.js'
await import(standaloneServer)
