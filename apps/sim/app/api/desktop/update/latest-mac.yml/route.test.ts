/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MANIFEST_ASSET_NAME } from '@/lib/desktop/update-feed'
import { GET } from './route'

const RELEASES_URL = 'https://api.github.com/repos/simstudioai/sim/releases?per_page=30'
const FEED_STATUS_HEADER = 'x-sim-desktop-update-feed'

function release(tag: string) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: tag.includes('-'),
    assets: [
      {
        name: MANIFEST_ASSET_NAME,
        browser_download_url: `https://downloads.example/${tag}/${MANIFEST_ASSET_NAME}`,
      },
    ],
  }
}

function manifest(version: string) {
  return [`version: ${version}`, 'files:', `  - url: Sim-${version}-universal-mac.zip`].join('\n')
}

async function getFeed(hostname: string): Promise<Response> {
  return GET(new NextRequest(`https://${hostname}/api/desktop/update/latest-mac.yml`), undefined)
}

describe('desktop update manifest route', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['www.dev.sim.ai', 'v1.2.0-dev.4', '1.2.0-dev.4'],
    ['www.staging.sim.ai', 'v1.2.0-staging.5', '1.2.0-staging.5'],
    ['www.sim.ai', 'v1.1.0', '1.1.0'],
  ])('serves the newest release for %s', async (hostname, tag, version) => {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === RELEASES_URL) {
        return Response.json([
          release('v1.2.0-dev.4'),
          release('v1.2.0-staging.5'),
          release('v1.1.0'),
        ])
      }
      if (url === `https://downloads.example/${tag}/${MANIFEST_ASSET_NAME}`) {
        return new Response(manifest(version))
      }
      return new Response(null, { status: 404 })
    })

    const response = await getFeed(hostname)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get(FEED_STATUS_HEADER)).toBe('release')
    expect(body).toContain(`version: ${version}`)
    expect(body).toContain(
      `https://github.com/simstudioai/sim/releases/download/${tag}/Sim-${version}-universal-mac.zip`
    )
  })

  it('reports an authoritative no-release result for production with only prereleases', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json([release('v1.2.0-dev.4'), release('v1.2.0-staging.5')])
    )

    const response = await getFeed('www.sim.ai')

    expect(response.status).toBe(404)
    expect(response.headers.get(FEED_STATUS_HEADER)).toBe('no-release')
    expect(await response.json()).toMatchObject({ error: 'No desktop release for channel latest' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a manifest whose version does not match its selected release', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json([release('v1.2.0-dev.4')]))
      .mockResolvedValueOnce(new Response(manifest('1.2.0-staging.5')))

    const response = await getFeed('www.dev.sim.ai')

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'Release manifest unavailable' })
  })
})
