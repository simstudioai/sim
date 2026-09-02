/**
 * @vitest-environment node
 */
import { setEnv } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_PRERELEASE_REPOSITORY,
  DESKTOP_STABLE_RELEASE_REPOSITORY,
  MANIFEST_ASSET_NAME,
  releasesApiUrl,
} from '@/lib/desktop/update-feed'
import { GET } from '@/app/api/desktop/update/download/route'

const STABLE_RELEASES_URL = releasesApiUrl(DESKTOP_STABLE_RELEASE_REPOSITORY, 1)
const PRERELEASE_RELEASES_URL = releasesApiUrl(DESKTOP_PRERELEASE_REPOSITORY, 1)

function release(tag: string, repository: string) {
  const base = `https://github.com/${repository}/releases/download/${tag}`
  const version = tag.replace(/^v/, '')
  return {
    tag_name: tag,
    draft: false,
    prerelease: tag.includes('-'),
    assets: [
      { name: MANIFEST_ASSET_NAME, browser_download_url: `${base}/${MANIFEST_ASSET_NAME}` },
      {
        name: `Sim-${version}-universal.zip`,
        browser_download_url: `${base}/Sim-${version}-universal.zip`,
      },
      {
        name: `Sim-${version}-universal.dmg`,
        browser_download_url: `${base}/Sim-${version}-universal.dmg`,
      },
    ],
  }
}

function manifest(version: string) {
  return [`version: ${version}`, 'files:', `  - url: Sim-${version}-universal.zip`].join('\n')
}

async function getDownload(): Promise<Response> {
  return GET(new NextRequest('https://www.sim.ai/api/desktop/update/download'), undefined)
}

describe('desktop update download route', () => {
  const fetchMock = vi.fn()

  function mockReleases(releases: ReturnType<typeof release>[]) {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === STABLE_RELEASES_URL || url === PRERELEASE_RELEASES_URL) {
        return Response.json(releases)
      }
      const candidate = releases.find((release) =>
        release.assets.some((asset) => asset.browser_download_url === url)
      )
      return candidate
        ? new Response(manifest(candidate.tag_name.replace(/^v/, '')))
        : new Response(null, { status: 404 })
    })
  }

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setEnv({ APPCONFIG_ENVIRONMENT: undefined })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('redirects to the newest stable installer', async () => {
    mockReleases([
      release('v1.1.0', DESKTOP_STABLE_RELEASE_REPOSITORY),
      release('v1.3.0', DESKTOP_STABLE_RELEASE_REPOSITORY),
      release('v1.2.0', DESKTOP_STABLE_RELEASE_REPOSITORY),
    ])

    const response = await getDownload()

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      `https://github.com/${DESKTOP_STABLE_RELEASE_REPOSITORY}/releases/download/v1.3.0/Sim-1.3.0-universal.dmg`
    )
    expect(fetchMock).toHaveBeenCalledWith(STABLE_RELEASES_URL, expect.any(Object))
  })

  it('serves its own deployment channel rather than the stable stream', async () => {
    setEnv({ APPCONFIG_ENVIRONMENT: 'dev' })
    mockReleases([
      release('v1.3.0-dev.4', DESKTOP_PRERELEASE_REPOSITORY),
      release('v1.4.0-staging.1', DESKTOP_PRERELEASE_REPOSITORY),
    ])

    const response = await getDownload()

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('Sim-1.3.0-dev.4-universal.dmg')
    expect(fetchMock).toHaveBeenCalledWith(PRERELEASE_RELEASES_URL, expect.any(Object))
  })

  it('falls back when the newest release has no installer artifact', async () => {
    const incomplete = release('v1.4.0', DESKTOP_STABLE_RELEASE_REPOSITORY)
    incomplete.assets = incomplete.assets.filter((asset) => asset.name === MANIFEST_ASSET_NAME)
    mockReleases([incomplete, release('v1.3.0', DESKTOP_STABLE_RELEASE_REPOSITORY)])

    const response = await getDownload()

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('Sim-1.3.0-universal.dmg')
  })

  it('reports no release when the channel has none', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json([release('v1.3.0-dev.4', DESKTOP_PRERELEASE_REPOSITORY)])
    )

    const response = await getDownload()

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: 'No desktop release for channel latest',
    })
  })

  it('reports an invalid feed when every release candidate is rejected', async () => {
    const incomplete = release('v1.4.0', DESKTOP_STABLE_RELEASE_REPOSITORY)
    incomplete.assets = incomplete.assets.filter((asset) => asset.name === MANIFEST_ASSET_NAME)
    mockReleases([incomplete])

    const response = await getDownload()

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'Release installer unavailable' })
  })

  it('reports an invalid feed when the release has no updater manifest', async () => {
    const incomplete = release('v1.4.0', DESKTOP_STABLE_RELEASE_REPOSITORY)
    incomplete.assets = incomplete.assets.filter((asset) => asset.name !== MANIFEST_ASSET_NAME)
    mockReleases([incomplete])

    const response = await getDownload()

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'Release installer unavailable' })
  })

  it('surfaces an unreadable release list instead of redirecting', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))

    const response = await getDownload()

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'Release feed unavailable' })
  })

  it('surfaces a GitHub network failure instead of returning an internal error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network unavailable'))

    const response = await getDownload()

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'Release feed unavailable' })
  })
})
