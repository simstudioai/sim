/**
 * The bundled docker-compose stack runs NODE_ENV=production, serves the app from
 * localhost, and leaves NEXT_PUBLIC_SOCKET_URL unset. getSocketUrl() falls back
 * to localhost:3002 for a localhost page regardless of NODE_ENV, so the CSP has
 * to permit that origin or the browser blocks the handshake and Socket.IO
 * retries forever. Its own file because vi.mock is hoisted per-module and the
 * sibling suite needs NEXT_PUBLIC_SOCKET_URL set.
 */
import { describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { setEnv } = await import('@sim/testing/mocks/env.mock')
  setEnv({
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    NEXT_PUBLIC_SOCKET_URL: undefined,
  })
})

import { generateRuntimeCSP } from './csp'

describe('generateRuntimeCSP — socket fallback on a localhost origin', () => {
  it('permits the default socket origin inside connect-src when NEXT_PUBLIC_SOCKET_URL is unset', () => {
    const connectSrc = generateRuntimeCSP()
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('connect-src'))

    expect(connectSrc).toContain('http://localhost:3002')
    expect(connectSrc).toContain('ws://localhost:3002')
  })
})
