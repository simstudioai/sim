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

async function getDownload(): Promise<Response> {
  return GET(new NextRequest('https://www.sim.ai/api/desktop/update/download'), undefined)
}

describe('desktop update download route', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setEnv({ APPCONFIG_ENVIRONMENT: undefined })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('redirects to the newest stable installer', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json([
        release('v1.1.0', DESKTOP_STABLE_RELEASE_REPOSITORY),
        release('v1.3.0', DESKTOP_STABLE_RELEASE_REPOSITORY),
        release('v1.2.0', DESKTOP_STABLE_RELEASE_REPOSITORY),
      ])
    )

    const response = await getDownload()

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      `https://github.com/${DESKTOP_STABLE_RELEASE_REPOSITORY}/releases/download/v1.3.0/Sim-1.3.0-universal.dmg`
    )
    expect(fetchMock).toHaveBeenCalledWith(STABLE_RELEASES_URL, expect.any(Object))
  })

  it('serves its own deployment channel rather than the stable stream', async () => {
    setEnv({ APPCONFIG_ENVIRONMENT: 'dev' })
    fetchMock.mockResolvedValueOnce(
      Response.json([
        release('v1.3.0-dev.4', DESKTOP_PRERELEASE_REPOSITORY),
        release('v1.4.0-staging.1', DESKTOP_PRERELEASE_REPOSITORY),
      ])
    )

    const response = await getDownload()

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('Sim-1.3.0-dev.4-universal.dmg')
    expect(fetchMock).toHaveBeenCalledWith(PRERELEASE_RELEASES_URL, expect.any(Object))
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

  it('surfaces an unreadable release list instead of redirecting', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))

    const response = await getDownload()

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'Release feed unavailable' })
  })
})
