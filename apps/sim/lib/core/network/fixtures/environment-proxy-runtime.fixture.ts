/** Real Bun probe invoked against the environment proxy test's local TLS servers. */
import { OutboundRoutingError } from '@/lib/core/network/routing'
import {
  createSsrfGuardedFetchWithDispatcher,
  secureFetchWithPinnedIP,
} from '@/lib/core/security/input-validation.server'

const [originPort] = process.argv.slice(2)
if (!originPort) throw new Error('Local fixture port is required')
const options = { profile: 'selfHostedService' as const }
const signal = AbortSignal.timeout(5_000)
const transport = createSsrfGuardedFetchWithDispatcher(options)
try {
  const response = await transport.fetch(`https://localhost:${originPort}`, {
    signal,
  })
  if ((await response.text()) !== 'tls reached') throw new Error('Guarded response mismatch')
  const pinned = await secureFetchWithPinnedIP(`https://localhost:${originPort}`, '127.0.0.1', {
    ...options,
    timeout: 5_000,
    signal,
  })
  if ((await pinned.text()) !== 'tls reached') throw new Error('Pinned response mismatch')
  let rejected = false
  try {
    await transport.fetch(`https://127.0.0.1:${originPort}`, {
      signal,
    })
  } catch (error) {
    if (!(error instanceof OutboundRoutingError) || error.code !== 'GATEWAY_UNAVAILABLE') {
      throw error
    }
    rejected = true
  }
  if (!rejected) throw new Error('Mismatched upstream certificate was accepted')
} finally {
  await transport.dispatcher.destroy()
}
