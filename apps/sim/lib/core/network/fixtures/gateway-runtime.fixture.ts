/** Real runtime probe invoked by gateway.server.test.ts against its local TLS servers. */
import { readFileSync } from 'node:fs'
import { HttpRequest } from '@smithy/core/protocols'
import { request as undiciRequest } from 'undici/index.js'
import { createOutboundAwsHttpHandler } from '@/lib/core/network/aws-handler.server'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { createGatewayDispatcher } from '@/lib/core/network/gateway.server'
import { secureFetchWithPinnedIP } from '@/lib/core/security/input-validation.server'

const [proxyPort, originPort, certificatePath] = process.argv.slice(2)
if (!proxyPort || !originPort || !certificatePath)
  throw new Error('Local fixture ports and certificate are required')
const gateway = {
  id: 'synthetic',
  url: `https://127.0.0.1:${proxyPort}`,
  servername: 'gateway.invalid',
  generation: 'test',
  token: 'a'.repeat(48),
  ca: readFileSync(certificatePath, 'utf8'),
}
const dispatcher = createGatewayDispatcher(gateway, {
  profile: 'selfHostedService',
  resolvedIP: '127.0.0.1',
})
const handler = createOutboundAwsHttpHandler()
try {
  const response = await undiciRequest(`https://localhost:${originPort}`, {
    dispatcher,
    signal: AbortSignal.timeout(10_000),
  })
  if (response.headers['x-via-proxy'] !== 'yes') throw new Error('Undici bypassed proxy')
  if ((await response.body.text()) !== 'tls reached') throw new Error('Undici response mismatch')

  await runWithOutboundOrganization('org_test', async () => {
    const pinned = await secureFetchWithPinnedIP(`https://localhost:${originPort}`, '127.0.0.1', {
      profile: 'selfHostedService',
      timeout: 10_000,
    })
    if (pinned.headers.get('x-via-proxy') !== 'yes') throw new Error('Pinned fetch bypassed proxy')
    if ((await pinned.text()) !== 'tls reached') throw new Error('Pinned fetch response mismatch')

    const { response: aws } = await handler.handle(
      new HttpRequest({
        protocol: 'https:',
        hostname: 'localhost',
        port: Number(originPort),
        method: 'GET',
        path: '/',
        headers: {},
        query: {},
      })
    )
    if (aws.headers['x-via-proxy'] !== 'yes') throw new Error('AWS handler bypassed proxy')
    const chunks: Buffer[] = []
    for await (const chunk of aws.body) chunks.push(Buffer.from(chunk))
    if (Buffer.concat(chunks).toString() !== 'tls reached') throw new Error('AWS response mismatch')
  })

  let rejected = false
  try {
    await undiciRequest(`https://127.0.0.1:${originPort}`, {
      dispatcher,
      headers: { host: `localhost:${originPort}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('Mismatched upstream certificate was accepted')
} finally {
  handler.destroy()
  await dispatcher.destroy()
}
