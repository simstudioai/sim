import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tunnels: string[] = []
let proxy: Server
let proxyUrl = ''

beforeAll(async () => {
  proxy = createServer((_req, res) => res.end())
  proxy.on('connect', (req, socket) => {
    socket.on('error', () => {})
    tunnels.push(String(req.url))
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
  })
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
})

afterAll(async () => {
  proxy.closeAllConnections()
  await new Promise<void>((resolve) => proxy.close(() => resolve()))
})

describe('loadRuntimeSecrets under a proxy-only egress', () => {
  it('reaches Secrets Manager through HTTPS_PROXY under the Bun runtime', async () => {
    const entry = fileURLToPath(new URL('./index.ts', import.meta.url))
    const run = promisify(execFile)(
      'bun',
      [
        '--no-env-file',
        '-e',
        `await (await import(${JSON.stringify(entry)})).loadRuntimeSecrets()`,
      ],
      {
        timeout: 20_000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          SIM_ENV_SECRET_ID: '/test/sim/env-vars',
          AWS_REGION: 'us-east-1',
          AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
          AWS_SECRET_ACCESS_KEY: 'secret',
          AWS_CONFIG_FILE: '/dev/null',
          AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
          AWS_ENDPOINT_URL_SECRETS_MANAGER: 'https://secrets.invalid',
          HTTPS_PROXY: proxyUrl,
          NO_PROXY: '',
        },
      }
    )
    await expect(run).rejects.toThrow(/Failed to fetch runtime secrets/)
    expect(tunnels).toContain('secrets.invalid:443')
  }, 30_000)
})
