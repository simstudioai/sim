/**
 * Pins what `maxAttempts` *means*, using the real AWS SDK.
 *
 * `route.test.ts` asserts the route configures `maxAttempts: 1`; on its own that
 * only pins a number. This file counts how many datapoints a real
 * `CloudWatchClient` actually hands to a peer that accepts the request and then
 * dies before writing a response byte -- the ambiguous transport failure the
 * SDK's retry layer replays, and the one that makes CloudWatch aggregate a
 * duplicate. It fails if a future SDK bump changes the default budget or stops
 * honouring the pin.
 *
 * Deliberately not mocking `@aws-sdk/client-cloudwatch` here: the SDK's retry
 * middleware is the subject under test, so it must be the real one.
 *
 * @vitest-environment node
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { describe, expect, it } from 'vitest'

/** `@smithy/util-retry`'s `DEFAULT_MAX_ATTEMPTS`, which every unpinned client inherits. */
const SDK_DEFAULT_MAX_ATTEMPTS = 3

async function countDeliveries(clientConfig: Record<string, unknown>): Promise<number> {
  let received = 0
  const server = http.createServer((req, res) => {
    req.on('data', () => {})
    req.on('end', () => {
      if (String(req.headers['x-amz-target'] ?? '').endsWith('PutMetricData')) {
        received++
        req.socket.destroy()
        return
      }
      res.writeHead(200, { 'content-type': 'application/x-amz-json-1.0' })
      res.end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  const client = new CloudWatchClient({
    region: 'us-east-1',
    endpoint: `http://127.0.0.1:${port}`,
    credentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' },
    ...clientConfig,
  })

  try {
    await client.send(
      new PutMetricDataCommand({
        Namespace: 'Sim/Test',
        MetricData: [{ MetricName: 'Requests', Value: 1 }],
      })
    )
  } catch {
    /* Every attempt fails by design; the delivery count is the assertion. */
  } finally {
    client.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  return received
}

describe('aws sdk retry semantics for PutMetricData', () => {
  it('delivers the datapoint exactly once when maxAttempts is pinned to 1', async () => {
    await expect(countDeliveries({ maxAttempts: 1 })).resolves.toBe(1)
  })

  it('aggregates a duplicate for every retry the default budget allows', async () => {
    await expect(countDeliveries({})).resolves.toBe(SDK_DEFAULT_MAX_ATTEMPTS)
  })
})
