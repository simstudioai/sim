/** Real runtime probe invoked by gateway.server.test.ts against its local TLS servers. */
import { readFileSync } from 'node:fs'
import { request as undiciRequest } from 'undici/index.js'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { createGatewayDispatcher } from '@/lib/core/network/gateway.server'
import { secureFetchWithPinnedIP } from '@/lib/core/security/input-validation.server'

const [proxyPort, certificatePath] = process.argv.slice(2)
if (!proxyPort || !certificatePath)
  throw new Error('Local fixture proxy port and certificate are required')
const gateway = {
  id: 'synthetic',
  organizationId: 'org_test',
  url: `https://127.0.0.1:${proxyPort}`,
  servername: 'gateway.invalid',
  token: 'a'.repeat(48),
  ca: readFileSync(certificatePath, 'utf8'),
}
const dispatcher = createGatewayDispatcher(gateway, {
  profile: 'selfHostedService',
  resolvedIP: '1.1.1.1',
})
try {
  const response = await undiciRequest('https://origin.invalid', {
    dispatcher,
    signal: AbortSignal.timeout(10_000),
  })
  if (response.headers['x-via-proxy'] !== 'yes') throw new Error('Undici bypassed proxy')
  if ((await response.body.text()) !== 'tls reached') throw new Error('Undici response mismatch')

  await runWithOutboundOrganization('org_test', async () => {
    const pinned = await secureFetchWithPinnedIP('https://origin.invalid', '1.1.1.1', {
      profile: 'selfHostedService',
      timeout: 10_000,
    })
    if (pinned.headers.get('x-via-proxy') !== 'yes') throw new Error('Pinned fetch bypassed proxy')
    if ((await pinned.text()) !== 'tls reached') throw new Error('Pinned fetch response mismatch')
  })

  let rejected = false
  try {
    await undiciRequest('https://wrong.invalid', {
      dispatcher,
      headers: { host: 'origin.invalid' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('Mismatched upstream certificate was accepted')
} finally {
  await dispatcher.destroy()
}
