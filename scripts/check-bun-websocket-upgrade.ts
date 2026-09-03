#!/usr/bin/env bun
/**
 * Asserts the current Bun binary delivers a real `'upgrade'` event for a successful (101)
 * WebSocket handshake, instead of routing it through `'response'`.
 *
 * apps/sim runs entirely on Bun in production (`docker/app.Dockerfile` boots
 * `apps/sim/bootstrap.js` with `bun`, not `node`). Tool routes that open an outbound WebSocket —
 * Stagehand's Browserbase/CDP session for the Run Agent operation is the known case — go through
 * Node's `http.request` + the `'upgrade'` event, which is exactly what a bundled CDP transport
 * (Playwright inlines its own WebSocket client rather than resolving the top-level `ws` package,
 * so Bun's package-level `ws` shim never intercepts it) relies on. Bun 1.3.x never delivered that
 * event for a genuine 101 response — the request's `'response'` handler fired instead, and the
 * client library then threw `Unexpected server response: 101` for what was actually a successful
 * upgrade. Fixed upstream in Bun 1.4.0 (oven-sh/bun#31792, oven-sh/bun#28114).
 *
 * The responder below is a raw `net` socket, not `http.createServer`: Bun 1.3.x's server-side
 * upgrade handling is also broken, so an `http`-based responder masks the client-side bug behind
 * a timeout instead of the actual `'response'`-instead-of-`'upgrade'` misclassification. A raw
 * socket keeps this probe honest about which side (the client, which is all Sim's outbound
 * connections ever exercise) is under test.
 *
 * @see https://github.com/oven-sh/bun/issues/31792
 */
import { createHash } from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('BunWebsocketUpgradeCheck')

const WEBSOCKET_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const CLIENT_KEY = 'dGhlIHNhbXBsZSBub25jZQ=='
const PROBE_TIMEOUT_MS = 10_000

function acceptKeyFor(key: string): string {
  return createHash('sha1')
    .update(key + WEBSOCKET_MAGIC)
    .digest('base64')
}

/** A raw TCP responder that answers exactly one WebSocket handshake with a 101, then closes. */
function startRawUpgradeResponder(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.once('data', (chunk) => {
        const match = /Sec-WebSocket-Key:\s*(\S+)/i.exec(chunk.toString('utf8'))
        if (!match) {
          socket.destroy()
          return
        }
        socket.end(
          [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${acceptKeyFor(match[1])}`,
            '',
            '',
          ].join('\r\n')
        )
      })
      socket.on('error', () => socket.destroy())
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind the raw upgrade responder'))
        return
      }
      resolve({ port: address.port, close: () => server.close() })
    })
  })
}

interface ProbeResult {
  event: 'upgrade' | 'response'
  statusCode: number | undefined
}

/** Issues an upgrade request through `node:http` and reports which event fires, and with what status. */
function probeUpgrade(port: number): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': CLIENT_KEY,
      },
    })

    const timeout = setTimeout(() => {
      req.destroy()
      reject(
        new Error(`Timed out after ${PROBE_TIMEOUT_MS}ms waiting for the handshake to resolve`)
      )
    }, PROBE_TIMEOUT_MS)

    req.on('upgrade', (res, socket) => {
      clearTimeout(timeout)
      socket.destroy()
      resolve({ event: 'upgrade', statusCode: res.statusCode })
    })
    req.on('response', (res) => {
      clearTimeout(timeout)
      res.resume()
      resolve({ event: 'response', statusCode: res.statusCode })
    })
    req.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    req.end()
  })
}

const BUG_REMEDIATION =
  "This is oven-sh/bun#31792 — outbound WebSocket clients (Stagehand/Playwright's Browserbase " +
  'CDP session, chrome-devtools-mcp, puppeteer) fail with "Unexpected server response: 101" ' +
  'even though the handshake succeeded. Fixed in Bun 1.4.0 — run ' +
  '`bun run check:bun-version-pins` to check whether a Bun version pin has drifted back below it.'

function reportFailure(reason: string): never {
  logger.error(`Bun WebSocket upgrade audit failed: ${reason}`)
  process.exit(1)
}

const { port, close } = await startRawUpgradeResponder()
let result: ProbeResult
try {
  result = await probeUpgrade(port)
} catch (error) {
  close()
  reportFailure(`could not complete the probe (${getErrorMessage(error)}).`)
}
close()

if (result.event !== 'upgrade' || result.statusCode !== 101) {
  reportFailure(
    `a successful 101 handshake fired '${result.event}' (status ${result.statusCode ?? 'unknown'}) ` +
      `instead of 'upgrade' with 101.\n\n  ${BUG_REMEDIATION}`
  )
}

logger.info("Bun WebSocket upgrade audit passed (a 101 response correctly fires 'upgrade').")
