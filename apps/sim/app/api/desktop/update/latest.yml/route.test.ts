import { setEnv } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_STABLE_RELEASE_REPOSITORY,
  MANIFEST_ASSET_NAME,
  releasesApiUrl,
  WINDOWS_MANIFEST_ASSET_NAME,
} from '@/lib/desktop/update-feed'
import { GET } from '@/app/api/desktop/update/latest.yml/route'

const STABLE_RELEASES_URL = releasesApiUrl(DESKTOP_STABLE_RELEASE_REPOSITORY, 1)
const FEED_STATUS_HEADER = 'x-sim-desktop-update-feed'

function asset(tag: string, name: string) {
  return { name, browser_download_url: `https://downloads.example/${tag}/${name}` }
}

/** A release carrying the macOS build, plus the Windows build when `windows` is set. */
function release(tag: string, options?: { windows?: boolean }) {
  const version = tag.replace(/^v/, '')
  return {
    tag_name: tag,
    draft: false,
    prerelease: tag.includes('-'),
    assets: [
      asset(tag, MANIFEST_ASSET_NAME),
      asset(tag, `Sim-${version}-universal.zip`),
      asset(tag, `Sim-${version}-universal.dmg`),
      ...(options?.windows
        ? [asset(tag, WINDOWS_MANIFEST_ASSET_NAME), asset(tag, `Sim-${version}-x64.exe`)]
        : []),
    ],
  }
}

function windowsManifest(version: string, artifact = `Sim-${version}-x64.exe`) {
  return [`version: ${version}`, 'files:', `  - url: ${artifact}`, `path: ${artifact}`].join('\n')
}

function macManifest(version: string) {
  return [`version: ${version}`, 'files:', `  - url: Sim-${version}-universal.zip`].join('\n')
}

async function getFeed(): Promise<Response> {
  return GET(new NextRequest('https://www.sim.ai/api/desktop/update/latest.yml'), undefined)
}

describe('desktop Windows update manifest route', () => {
  const fetchMock = vi.fn()

  function mockFeed(
    releases: ReturnType<typeof release>[],
    manifests: Record<string, string>
  ): void {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === STABLE_RELEASES_URL) return Response.json(releases)
      const body = manifests[url]
      return body === undefined ? new Response(null, { status: 404 }) : new Response(body)
    })
  }

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setEnv({ APPCONFIG_ENVIRONMENT: undefined })
  })

  it('serves the Windows manifest, never the macOS one', async () => {
    mockFeed([release('v1.1.0', { windows: true })], {
      [`https://downloads.example/v1.1.0/${WINDOWS_MANIFEST_ASSET_NAME}`]: windowsManifest('1.1.0'),
      [`https://downloads.example/v1.1.0/${MANIFEST_ASSET_NAME}`]: macManifest('1.1.0'),
    })

    const response = await getFeed()
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get(FEED_STATUS_HEADER)).toBe('release')
    expect(body).toContain(
      `  - url: https://github.com/${DESKTOP_STABLE_RELEASE_REPOSITORY}/releases/download/v1.1.0/Sim-1.1.0-x64.exe`
    )
    expect(body).not.toContain('universal')
  })

  it('passes over a newer release whose Windows build was never published', async () => {
    mockFeed([release('v1.2.0'), release('v1.1.0', { windows: true })], {
      [`https://downloads.example/v1.1.0/${WINDOWS_MANIFEST_ASSET_NAME}`]: windowsManifest('1.1.0'),
    })

    const response = await getFeed()

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('version: 1.1.0')
  })

  it('reports no release, not a broken feed, before any Windows build ships', async () => {
    mockFeed([release('v1.2.0'), release('v1.1.0')], {})

    const response = await getFeed()

    expect(response.status).toBe(404)
    expect(response.headers.get(FEED_STATUS_HEADER)).toBe('no-release')
  })

  it('rejects a Windows manifest that points at macOS artifacts', async () => {
    mockFeed([release('v1.1.0', { windows: true })], {
      [`https://downloads.example/v1.1.0/${WINDOWS_MANIFEST_ASSET_NAME}`]: windowsManifest(
        '1.1.0',
        'Sim-1.1.0-universal.zip'
      ),
    })

    const response = await getFeed()

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'Release manifest unavailable' })
  })
})
