import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { createLocalPageHandler, isLocalPageUrl, LOCAL_PAGE_ORIGIN } from '@/main/local-pages'

describe('isLocalPageUrl', () => {
  // The IPC gate for shell control runs on this: a page the server serves, a
  // stray file, or a bundled asset that is not a page must all be refused.
  it('rejects every other scheme, host, and path', () => {
    for (const url of [
      'file:///app/static/offline.html',
      'https://www.sim.ai/offline.html',
      'sim-shell://evil/offline.html',
      'sim-shell://pages/SeasonSansUprightsVF.woff2',
      'sim-shell://pages/server.js',
      'sim-shell://pages/server.css',
      'sim-shell://pages/static/offline.html',
      'sim-shell://pages/',
      'not a url',
      '',
    ]) {
      expect(isLocalPageUrl(url), url).toBe(false)
    }
  })
})

describe('createLocalPageHandler', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'sim-local-pages-'))
    writeFileSync(join(root, 'offline.html'), '<h1>offline</h1>')
    writeFileSync(join(root, 'secret.txt'), 'nope')
    writeFileSync(join(root, 'server.js'), 'window.renderServerModal()')
    writeFileSync(join(root, 'server.css'), 'body { margin: 0 }')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('refuses everything outside the allowlist, however the path is spelled', async () => {
    const handler = createLocalPageHandler([root])
    for (const path of [
      '/secret.txt',
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/static/offline.html',
      '/',
    ]) {
      const response = await handler(new Request(`${LOCAL_PAGE_ORIGIN}${path}`))
      expect(response.status, path).toBe(404)
    }
  })

  it('refuses a foreign host and non-GET methods', async () => {
    const handler = createLocalPageHandler([root])

    expect((await handler(new Request('sim-shell://evil/offline.html'))).status).toBe(404)
    expect(
      (await handler(new Request(`${LOCAL_PAGE_ORIGIN}/offline.html`, { method: 'POST' }))).status
    ).toBe(405)
  })
})
