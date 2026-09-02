/**
 * @vitest-environment node
 */
import { setEnv } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_PRERELEASE_REPOSITORY,
  DESKTOP_RELEASES_PAGE_SIZE,
  DESKTOP_STABLE_RELEASE_REPOSITORY,
  MANIFEST_ASSET_NAME,
  releasesApiUrl,
} from '@/lib/desktop/update-feed'
import { GET } from '@/app/api/desktop/update/latest-mac.yml/route'

const STABLE_RELEASES_URL = releasesApiUrl(DESKTOP_STABLE_RELEASE_REPOSITORY, 1)
const PRERELEASE_RELEASES_URL = releasesApiUrl(DESKTOP_PRERELEASE_REPOSITORY, 1)
const FEED_STATUS_HEADER = 'x-sim-desktop-update-feed'

function release(tag: string) {
  const version = tag.replace(/^v/, '')
  return {
    tag_name: tag,
    draft: false,
    prerelease: tag.includes('-'),
    assets: [
      {
        name: MANIFEST_ASSET_NAME,
        browser_download_url: `https://downloads.example/${tag}/${MANIFEST_ASSET_NAME}`,
      },
      {
        name: `Sim-${version}-universal.zip`,
        browser_download_url: `https://downloads.example/${tag}/Sim-${version}-universal.zip`,
      },
      {
        name: `Sim-${version}-universal.dmg`,
        browser_download_url: `https://downloads.example/${tag}/Sim-${version}-universal.dmg`,
      },
    ],
  }
}

function manifest(version: string) {
  return [`version: ${version}`, 'files:', `  - url: Sim-${version}-universal.zip`].join('\n')
}

async function getFeed(hostname: string, headers?: HeadersInit): Promise<Response> {
  return GET(
    new NextRequest(`https://${hostname}/api/desktop/update/latest-mac.yml`, { headers }),
    undefined
  )
}

describe('desktop update manifest route', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setEnv({ APPCONFIG_ENVIRONMENT: undefined })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['dev', 'v1.2.0-dev.4', '1.2.0-dev.4', DESKTOP_PRERELEASE_REPOSITORY],
    ['staging', 'v1.2.0-staging.5', '1.2.0-staging.5', DESKTOP_PRERELEASE_REPOSITORY],
    ['production', 'v1.1.0', '1.1.0', DESKTOP_STABLE_RELEASE_REPOSITORY],
  ])(
    'serves the newest release for the %s deployment',
    async (environment, tag, version, repository) => {
      setEnv({ APPCONFIG_ENVIRONMENT: environment })
      fetchMock.mockImplementation(async (input: string | URL | Request) => {
        const url = String(input)
        if (url === PRERELEASE_RELEASES_URL) {
          return Response.json([release('v1.2.0-dev.4'), release('v1.2.0-staging.5')])
        }
        if (url === STABLE_RELEASES_URL) {
          return Response.json([release('v1.1.0')])
        }
        if (url === `https://downloads.example/${tag}/${MANIFEST_ASSET_NAME}`) {
          return new Response(manifest(version))
        }
        return new Response(null, { status: 404 })
      })

      const response = await getFeed('internal.service.local')
      const body = await response.text()

      expect(response.status).toBe(200)
      expect(response.headers.get(FEED_STATUS_HEADER)).toBe('release')
      expect(body).toContain(`version: ${version}`)
      expect(body).toContain(
        `https://github.com/${repository}/releases/download/${tag}/Sim-${version}-universal.zip`
      )
    }
  )

  it.each([
    ['dev', 'www.staging.sim.ai:443', 'v1.2.0-dev.4', '1.2.0-dev.4'],
    ['staging', 'www.sim.ai:443', 'v1.2.0-staging.5', '1.2.0-staging.5'],
    ['production', 'www.dev.sim.ai:443', 'v1.1.0', '1.1.0'],
  ])(
    'ignores request-controlled host headers for the %s deployment',
    async (environment, spoofedHost, tag, version) => {
      setEnv({ APPCONFIG_ENVIRONMENT: environment })
      fetchMock.mockImplementation(async (input: string | URL | Request) => {
        const url = String(input)
        if (url === PRERELEASE_RELEASES_URL) {
          return Response.json([release('v1.2.0-dev.4'), release('v1.2.0-staging.5')])
        }
        if (url === STABLE_RELEASES_URL) {
          return Response.json([release('v1.1.0')])
        }
        if (url === `https://downloads.example/${tag}/${MANIFEST_ASSET_NAME}`) {
          return new Response(manifest(version))
        }
        return new Response(null, { status: 404 })
      })

      const response = await getFeed('internal.service.local', {
        host: spoofedHost,
        'x-forwarded-host': `attacker.example, ${spoofedHost}`,
      })
      const body = await response.text()

      expect(response.status).toBe(200)
      expect(response.headers.get(FEED_STATUS_HEADER)).toBe('release')
      expect(body).toContain(`version: ${version}`)
    }
  )

  it('defaults self-hosted deployments to the stable channel', async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === STABLE_RELEASES_URL) {
        return Response.json([release('v1.1.0')])
      }
      if (url === `https://downloads.example/v1.1.0/${MANIFEST_ASSET_NAME}`) {
        return new Response(manifest('1.1.0'))
      }
      return new Response(null, { status: 404 })
    })

    const response = await getFeed('internal.service.local', {
      host: 'www.dev.sim.ai:443',
      'x-forwarded-host': 'www.dev.sim.ai:443',
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('version: 1.1.0')
    expect(fetchMock).toHaveBeenCalledWith(STABLE_RELEASES_URL, expect.any(Object))
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

  it('reports an invalid feed when the release has no updater manifest', async () => {
    const incomplete = release('v1.1.0')
    incomplete.assets = incomplete.assets.filter((asset) => asset.name !== MANIFEST_ASSET_NAME)
    fetchMock.mockResolvedValueOnce(Response.json([incomplete]))

    const response = await getFeed('www.sim.ai')

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'Release manifest unavailable' })
  })

  it('walks past a page of unrelated releases to reach the newest desktop build', async () => {
    const filler = Array.from({ length: DESKTOP_RELEASES_PAGE_SIZE }, (_, index) => ({
      tag_name: `python-sdk-v0.${index}.0`,
      draft: false,
      prerelease: false,
      assets: [],
    }))
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === releasesApiUrl(DESKTOP_STABLE_RELEASE_REPOSITORY, 1)) {
        return Response.json(filler)
      }
      if (url === releasesApiUrl(DESKTOP_STABLE_RELEASE_REPOSITORY, 2)) {
        return Response.json([release('v1.1.0')])
      }
      if (url === `https://downloads.example/v1.1.0/${MANIFEST_ASSET_NAME}`) {
        return new Response(manifest('1.1.0'))
      }
      return new Response(null, { status: 404 })
    })

    const response = await getFeed('www.sim.ai')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('version: 1.1.0')
  })

  it('stops walking at a short page rather than requesting empty ones', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json([release('v1.2.0-dev.4'), release('v1.2.0-staging.5')])
    )

    const response = await getFeed('www.sim.ai')

    expect(response.status).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails the feed instead of serving an older release when a page cannot be read', async () => {
    const filler = Array.from({ length: DESKTOP_RELEASES_PAGE_SIZE }, (_, index) => ({
      tag_name: `python-sdk-v0.${index}.0`,
      draft: false,
      prerelease: false,
      assets: [],
    }))
    fetchMock
      .mockResolvedValueOnce(Response.json(filler))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))

    const response = await getFeed('www.sim.ai')

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'Release feed unavailable' })
  })

  it('rejects a manifest whose version does not match its selected release', async () => {
    setEnv({ APPCONFIG_ENVIRONMENT: 'dev' })
    fetchMock
      .mockResolvedValueOnce(Response.json([release('v1.2.0-dev.4')]))
      .mockResolvedValueOnce(new Response(manifest('1.2.0-staging.5')))

    const response = await getFeed('www.dev.sim.ai')

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'Release manifest unavailable' })
    expect(fetchMock).toHaveBeenNthCalledWith(1, PRERELEASE_RELEASES_URL, expect.any(Object))
  })

  it('falls back when the newest release has an invalid manifest', async () => {
    setEnv({ APPCONFIG_ENVIRONMENT: 'dev' })
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === PRERELEASE_RELEASES_URL) {
        return Response.json([release('v1.2.0-dev.5'), release('v1.2.0-dev.4')])
      }
      if (url === `https://downloads.example/v1.2.0-dev.5/${MANIFEST_ASSET_NAME}`) {
        return new Response(manifest('1.2.0-staging.5'))
      }
      if (url === `https://downloads.example/v1.2.0-dev.4/${MANIFEST_ASSET_NAME}`) {
        return new Response(manifest('1.2.0-dev.4'))
      }
      return new Response(null, { status: 404 })
    })

    const response = await getFeed('www.dev.sim.ai')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('version: 1.2.0-dev.4')
  })

  it('rejects an oversized updater manifest', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json([release('v1.1.0')]))
      .mockResolvedValueOnce(new Response(new Uint8Array(256 * 1024 + 1)))

    const response = await getFeed('www.sim.ai')

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'Release manifest unavailable' })
  })

  it('surfaces malformed GitHub release data as a feed failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not json'))

    const response = await getFeed('www.sim.ai')

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'Release feed unavailable' })
  })
})
