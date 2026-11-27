/**
 * Proves organization gateway routing under the real Bun runtime, which the Node-hosted unit suite
 * cannot: undici and the pinned fetch ride Bun's own `node:net`/`node:tls` shims there. The probe is
 * a separate Bun process, so most of its cost is starting Bun and loading the gateway's module graph.
 * That cost runs from about 0.1s idle to several seconds on a saturated unit shard, which is why the
 * probe lives in this one-file-at-a-time tier rather than inside a unit test's 10s budget.
 */
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type GatewayTlsFixture,
  startGatewayTlsFixture,
} from '@/lib/core/network/gateway-tls.test-helpers'

const GATEWAY_TOKEN = 'a'.repeat(48)
let fixture: GatewayTlsFixture
beforeAll(async () => {
  fixture = await startGatewayTlsFixture([GATEWAY_TOKEN])
})
afterAll(() => fixture.close())

describe('organization gateways under the Bun runtime', () => {
  it('routes and verifies TLS under the actual Bun runtime', async () => {
    await promisify(execFile)(
      'bun',
      [
        '--no-env-file',
        'run',
        fileURLToPath(new URL('./fixtures/gateway-runtime.fixture.ts', import.meta.url)),
        String(fixture.proxyPort),
        fixture.certificatePath,
      ],
      {
        timeout: 25_000,
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: fixture.certificatePath,
          OUTBOUND_ROUTING_SOURCE: 'env',
          OUTBOUND_ROUTING_CONFIG: JSON.stringify({
            schemaVersion: 1,
            revision: 'test',
            organizations: { org_test: { kind: 'gateway', gatewayId: 'synthetic' } },
          }),
          OUTBOUND_GATEWAYS: JSON.stringify({
            synthetic: {
              organizationId: 'org_test',
              url: `https://127.0.0.1:${fixture.proxyPort}`,
              servername: 'gateway.invalid',
              credentialId: 'synthetic',
            },
          }),
          OUTBOUND_GATEWAY_CREDENTIALS: JSON.stringify({
            synthetic: { token: GATEWAY_TOKEN, ca: fixture.cert },
          }),
        },
      }
    )
    expect(fixture.admissions.map((admission) => admission.token)).toEqual(
      Array(4).fill(`Bearer ${GATEWAY_TOKEN}`)
    )
  })
})
