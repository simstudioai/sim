import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session } from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import {
  attachLocalPageProtocol,
  createLocalPageHandler,
  isLocalPageUrl,
  LOCAL_PAGE_ORIGIN,
  localPageUrl,
} from '@/main/local-pages'

describe('localPageUrl', () => {
  it('addresses the bundled pages on the shell scheme', () => {
    expect(localPageUrl('server.html')).toBe('sim-shell://pages/server.html')
    expect(localPageUrl('offline.html')).toBe('sim-shell://pages/offline.html')
  })

  it('encodes the query it is given', () => {
    const url = new URL(
      localPageUrl('offline.html', { kind: 'dns', detail: 'ERR_NAME_NOT_RESOLVED (-105)' })
    )
    // Node's URL parser has no notion of Chromium's `standard` privilege, so
    // `origin` serialises as "null" here; scheme, host and path are what count.
    expect(url.protocol).toBe('sim-shell:')
    expect(url.host).toBe('pages')
    expect(url.pathname).toBe('/offline.html')
    expect(url.searchParams.get('kind')).toBe('dns')
    expect(url.searchParams.get('detail')).toBe('ERR_NAME_NOT_RESOLVED (-105)')
  })
})

describe('isLocalPageUrl', () => {
  it('accepts the bundled pages with or without a query', () => {
    expect(isLocalPageUrl('sim-shell://pages/offline.html')).toBe(true)
    expect(isLocalPageUrl('sim-shell://pages/offline.html?kind=dns&detail=x')).toBe(true)
    expect(isLocalPageUrl('sim-shell://pages/server.html')).toBe(true)
  })

  // The IPC gate for shell control runs on this: a page the server serves, a
  // stray file, or a bundled asset that is not a page must all be refused.
  it('rejects every other scheme, host, and path', () => {
    for (const url of [
      'file:///app/static/offline.html',
      'https://www.sim.ai/offline.html',
      'sim-shell://evil/offline.html',
      'sim-shell://pages/SeasonSansUprightsVF.woff2',
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
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('serves allowlisted files with their content type', async () => {
    const response = await createLocalPageHandler([root])(
      new Request(`${LOCAL_PAGE_ORIGIN}/offline.html?kind=dns`)
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('<h1>offline</h1>')
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

  it('answers 404 for an allowlisted file that is missing on disk', async () => {
    const response = await createLocalPageHandler([root])(
      new Request(`${LOCAL_PAGE_ORIGIN}/server.html`)
    )

    expect(response.status).toBe(404)
  })

  // Unpackaged runs read the brand font from the web app's public fonts rather
  // than a generated copy in static/, so roots are consulted in order.
  it('falls through to a later root for an asset the first one lacks', async () => {
    const fonts = mkdtempSync(join(tmpdir(), 'sim-local-pages-fonts-'))
    writeFileSync(join(fonts, 'SeasonSansUprightsVF.woff2'), 'woff2-bytes')
    try {
      const handler = createLocalPageHandler([root, fonts])

      const font = await handler(new Request(`${LOCAL_PAGE_ORIGIN}/SeasonSansUprightsVF.woff2`))
      expect(font.status).toBe(200)
      expect(font.headers.get('content-type')).toBe('font/woff2')
      expect(await font.text()).toBe('woff2-bytes')

      const page = await handler(new Request(`${LOCAL_PAGE_ORIGIN}/offline.html`))
      expect(await page.text()).toBe('<h1>offline</h1>')
    } finally {
      rmSync(fonts, { recursive: true, force: true })
    }
  })
})

describe('attachLocalPageProtocol', () => {
  it('installs one handler per session', () => {
    const ses = {
      protocol: { isProtocolHandled: vi.fn(() => false), handle: vi.fn() },
    }

    attachLocalPageProtocol(ses as unknown as Session, ['/tmp/static'])
    expect(ses.protocol.handle).toHaveBeenCalledWith('sim-shell', expect.any(Function))

    ses.protocol.isProtocolHandled.mockReturnValue(true)
    attachLocalPageProtocol(ses as unknown as Session, ['/tmp/static'])
    expect(ses.protocol.handle).toHaveBeenCalledTimes(1)
  })
})
