import { describe, expect, it, vi } from 'vitest'
import { describeProbe, probeDownload, resolveDeploymentUrl, sanitizeForTerminal } from './desktop'
import { SetupError } from './errors'

const ASSET = 'https://github.com/simstudioai/sim/releases/download/v1.2.3/Sim-1.2.3-universal.dmg'

function source(appUrl?: string, label = 'configuration') {
  return {
    label,
    values: appUrl ? new Map([['NEXT_PUBLIC_APP_URL', appUrl]]) : new Map<string, string>(),
  }
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

  // This command prints one URL as the one to trust and offers to open it, so
  // preferring whichever source happened to enumerate first would quietly send
  // an operator with a local checkout AND a real deployment to localhost.
  it('refuses to guess when sources name different deployments', () => {
    expect(() =>
      resolveDeploymentUrl([source('http://localhost:3000'), source('https://sim.example.com')])
    ).toThrow(SetupError)
  })

  // These spell one deployment four ways. Treating them as a conflict would
  // demand a --url override to settle an ambiguity that does not exist.
  it('treats equivalent spellings of one deployment as agreement', () => {
    expect(
      resolveDeploymentUrl([
        source('https://sim.example.com'),
        source('https://sim.example.com/'),
        source('https://SIM.example.com'),
        source('https://sim.example.com:443/workspace'),
      ])
    ).toBe('https://sim.example.com')
  })

  it('accepts agreeing sources and an override that settles the ambiguity', () => {
    expect(
      resolveDeploymentUrl([source('https://sim.example.com'), source('https://sim.example.com')])
    ).toBe('https://sim.example.com')
    expect(
      resolveDeploymentUrl(
        [source('http://localhost:3000'), source('https://sim.example.com')],
        'https://sim.example.com'
      )
    ).toBe('https://sim.example.com')
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

  // The end-to-end path that matters: a deployment can percent-encode ANSI in
  // the redirect, and decodeURIComponent turns it into real control bytes on
  // their way to the spinner.
  it('sanitizes a redirect filename before it reaches the terminal', async () => {
    const hostile = 'https://example.com/d/v1/Sim%1b%5b2K%1b%5b1Gforged.dmg'

    const result = await probeDownload(
      'https://sim.example.com/x',
      respond(302, { location: hostile })
    )

    expect(result).toEqual({
      status: 'ok',
      installerUrl: hostile,
      installerName: 'Sim[2K[1Gforged.dmg',
    })
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

describe('sanitizeForTerminal', () => {
  // The name comes out of a redirect the deployment chose, so it is remote
  // input on its way to a TTY.
  it('strips control characters a deployment could smuggle through the redirect', () => {
    expect(sanitizeForTerminal('Sim\u001b[2K\u001b[1G forged.dmg')).toBe('Sim[2K[1G forged.dmg')
    expect(sanitizeForTerminal('a\u0000b\u007fc\u009fd')).toBe('abcd')
    expect(sanitizeForTerminal('Sim-1.2.3-universal.dmg')).toBe('Sim-1.2.3-universal.dmg')
  })

  // Bidi overrides and isolates reorder what the reader sees without emitting a
  // single control byte, so a range-based C0/C1 filter lets them straight
  // through — `gpj.dmg` can be made to render as `dmg.jpg`.
  it('strips bidi controls, not just cursor controls', () => {
    expect(sanitizeForTerminal('Sim\u202e gmd.eno\u202c.dmg')).toBe('Sim gmd.eno.dmg')
    for (const control of ['\u200e', '\u200f', '\u202a', '\u202d', '\u2066', '\u2069', '\u061c']) {
      expect(sanitizeForTerminal(`a${control}b`)).toBe('ab')
    }
  })

  it('caps a name that would overrun the spinner line', () => {
    const capped = sanitizeForTerminal('x'.repeat(500))

    expect(capped).toBe(`${'x'.repeat(120)}...`)
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
