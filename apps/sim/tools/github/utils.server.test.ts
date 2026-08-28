/**
 * Pins the redirect contract of the GitHub direct-execution transport: the workspace
 * token must never cross an origin boundary, while a legitimate same-origin GitHub
 * redirect (a renamed repository) must stay authenticated.
 *
 * @vitest-environment node
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/security/dns', () => ({
  resolveHostAddresses: vi.fn(async () => ({ addresses: ['127.0.0.1'] })),
  preferIpv4: (addresses: string[]) => addresses[0],
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isHosted: false,
  egressAllowedHosts: undefined,
  egressAllowedIpRanges: undefined,
  getProxyUrl: () => undefined,
}))

import { secureGitHubRequest } from '@/tools/github/utils.server'

interface RecordedHop {
  url: string
  method: string
  body: string
  headers: http.IncomingHttpHeaders
}

const servers: http.Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

async function startServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function record(hops: RecordedHop[], req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    hops.push({ url: req.url ?? '', method: req.method ?? '', body, headers: req.headers })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')
  })
}

/** Records every request it receives, then answers 200. */
async function startRecordingServer(hops: RecordedHop[]): Promise<string> {
  return startServer((req, res) => record(hops, req, res))
}

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github.v3+json',
  Authorization: 'Bearer ghp_workspace_token',
  'X-GitHub-Api-Version': '2022-11-28',
}

describe('secureGitHubRequest redirects', () => {
  it('does not forward the GitHub token across an origin boundary', async () => {
    const hops: RecordedHop[] = []
    const attacker = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(302, { location: `${attacker}/stolen` })
      res.end()
    })

    const response = await secureGitHubRequest(origin, { headers: GITHUB_HEADERS })

    expect(response.status).toBe(200)
    expect(hops).toHaveLength(1)
    expect(hops[0].url).toBe('/stolen')
    expect(hops[0].headers.authorization).toBeUndefined()
  })

  it('does not forward the GitHub token when a comment POST crosses an origin boundary', async () => {
    const hops: RecordedHop[] = []
    const attacker = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(302, { location: `${attacker}/stolen` })
      res.end()
    })

    await secureGitHubRequest(origin, {
      method: 'POST',
      headers: { ...GITHUB_HEADERS, 'Content-Type': 'application/json' },
      body: '{"body":"Looks good"}',
    })

    expect(hops).toHaveLength(1)
    expect(hops[0].headers.authorization).toBeUndefined()
    expect(hops[0].headers.cookie).toBeUndefined()
  })

  it('replays a comment POST as a POST across a same-origin renamed-repository 301', async () => {
    const hops: RecordedHop[] = []
    const origin = await startServer((req, res) => {
      if (req.url === '/repos/octo/old/pulls/7/comments') {
        req.resume()
        res.writeHead(301, { location: '/repos/octo/new/pulls/7/comments' })
        res.end()
        return
      }
      record(hops, req, res)
    })

    await secureGitHubRequest(`${origin}/repos/octo/old/pulls/7/comments`, {
      method: 'POST',
      headers: { ...GITHUB_HEADERS, 'Content-Type': 'application/json' },
      body: '{"body":"Looks good"}',
    })

    expect(hops).toHaveLength(1)
    expect(hops[0].url).toBe('/repos/octo/new/pulls/7/comments')
    expect(hops[0].method).toBe('POST')
    expect(hops[0].body).toBe('{"body":"Looks good"}')
    expect(hops[0].headers.authorization).toBe('Bearer ghp_workspace_token')
  })

  it('keeps the token on a same-origin redirect, as a renamed repository needs', async () => {
    const hops: RecordedHop[] = []
    const origin = await startServer((req, res) => {
      if (req.url === '/repos/octo/old/pulls/7') {
        req.resume()
        res.writeHead(301, { location: '/repos/octo/new/pulls/7' })
        res.end()
        return
      }
      record(hops, req, res)
    })

    const response = await secureGitHubRequest(`${origin}/repos/octo/old/pulls/7`, {
      headers: GITHUB_HEADERS,
    })

    expect(response.status).toBe(200)
    expect(hops).toHaveLength(1)
    expect(hops[0].url).toBe('/repos/octo/new/pulls/7')
    expect(hops[0].headers.authorization).toBe('Bearer ghp_workspace_token')
  })
})

describe('secureGitHubRequest User-Agent', () => {
  it('sends an explicit Sim User-Agent on the commit lookup and the comment POST', async () => {
    const hops: RecordedHop[] = []
    const origin = await startRecordingServer(hops)

    await secureGitHubRequest(`${origin}/repos/octo/repo/pulls/7`, { headers: GITHUB_HEADERS })
    await secureGitHubRequest(`${origin}/repos/octo/repo/pulls/7/comments`, {
      method: 'POST',
      headers: { ...GITHUB_HEADERS, 'Content-Type': 'application/json' },
      body: '{"body":"Looks good"}',
    })

    expect(hops).toHaveLength(2)
    expect(hops[0].headers['user-agent']).toBe('Sim')
    expect(hops[1].headers['user-agent']).toBe('Sim')
  })

  it('leaves a caller-supplied User-Agent untouched', async () => {
    const hops: RecordedHop[] = []
    const origin = await startRecordingServer(hops)

    await secureGitHubRequest(origin, {
      headers: { ...GITHUB_HEADERS, 'user-agent': 'Sim-Custom' },
    })

    expect(hops[0].headers['user-agent']).toBe('Sim-Custom')
  })
})
