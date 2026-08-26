import { describe, expect, it, vi } from 'vitest'
import { describeProbe, probeDownload, resolveDeploymentUrl } from './desktop'
import { SetupError } from './errors'

const ASSET = 'https://github.com/simstudioai/sim/releases/download/v1.2.3/Sim-1.2.3-universal.dmg'

function source(appUrl?: string) {
  return { values: appUrl ? new Map([['NEXT_PUBLIC_APP_URL', appUrl]]) : new Map<string, string>() }
}

function respond(status: number, headers: Record<string, string> = {}): typeof fetch {
  return vi.fn(async () => new Response(null, { status, headers })) as unknown as typeof fetch
}

describe('resolveDeploymentUrl', () => {
  it('reads the deployment origin from the discovered configuration', () => {
    expect(resolveDeploymentUrl([source(), source('https://sim.example.com')])).toBe(
      'https://sim.example.com'
    )
  })

  it('strips any path so the API paths append cleanly', () => {
    expect(resolveDeploymentUrl([source('https://sim.example.com/workspace/')])).toBe(
      'https://sim.example.com'
    )
  })

  it('prefers an explicit override over the configured value', () => {
    expect(resolveDeploymentUrl([source('https://sim.example.com')], 'https://other.example')).toBe(
      'https://other.example'
    )
  })

  // Compose supplies this via `${VAR:-default}` interpolation, so an absent
  // key means "the wizard default", not a broken install.
  it('falls back to the local wizard origin when nothing is configured', () => {
    expect(resolveDeploymentUrl([source()])).toBe('http://localhost:3000')
  })

  it('rejects a value that is not an http(s) URL', () => {
    expect(() => resolveDeploymentUrl([source('sim.example.com')])).toThrow(SetupError)
    expect(() => resolveDeploymentUrl([source('ftp://sim.example.com')])).toThrow(SetupError)
  })
})

describe('probeDownload', () => {
  it('reports the artifact the deployment redirects to', async () => {
    const result = await probeDownload(
      'https://sim.example.com/api/desktop/update/download',
      respond(302, { location: ASSET })
    )

    expect(result).toEqual({
      status: 'ok',
      installerUrl: ASSET,
      installerName: 'Sim-1.2.3-universal.dmg',
    })
  })

  it('accepts every redirect status the endpoint may answer with', async () => {
    for (const status of [301, 302, 307, 308]) {
      expect(
        await probeDownload('https://sim.example.com/x', respond(status, { location: ASSET }))
      ).toMatchObject({ status: 'ok' })
    }
  })

  it('distinguishes no-release from a broken release feed', async () => {
    expect(await probeDownload('https://sim.example.com/x', respond(404))).toEqual({
      status: 'no-release',
    })
    expect(await probeDownload('https://sim.example.com/x', respond(502))).toEqual({
      status: 'feed-unavailable',
    })
  })

  it('reports an unreachable deployment rather than throwing', async () => {
    const failing = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    }) as unknown as typeof fetch

    expect(await probeDownload('https://sim.example.com/x', failing)).toEqual({
      status: 'unreachable',
      error: 'connect ECONNREFUSED',
    })
  })

  it('does not follow the redirect', async () => {
    const impl = respond(302, { location: ASSET })
    await probeDownload('https://sim.example.com/x', impl)

    expect(impl).toHaveBeenCalledWith(
      'https://sim.example.com/x',
      expect.objectContaining({ redirect: 'manual' })
    )
  })
})

describe('describeProbe', () => {
  // Failure statuses are the ones an operator has to act on, so each must
  // arrive with something to try.
  it('gives every failure status actionable hints', () => {
    for (const probe of [
      { status: 'no-release' },
      { status: 'feed-unavailable' },
      { status: 'unreachable', error: 'boom' },
    ] as const) {
      expect(describeProbe(probe, 'https://sim.example.com').hints.length).toBeGreaterThan(0)
    }
  })

  it('names the resolved artifact on success and asks for nothing', () => {
    const described = describeProbe(
      { status: 'ok', installerUrl: ASSET, installerName: 'Sim-1.2.3-universal.dmg' },
      'https://sim.example.com'
    )

    expect(described.headline).toContain('Sim-1.2.3-universal.dmg')
    expect(described.hints).toEqual([])
  })
})
