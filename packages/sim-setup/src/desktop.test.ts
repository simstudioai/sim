import { describe, expect, it, vi } from 'vitest'
import { probeDownload, resolveDeploymentUrl, sanitizeForTerminal } from './desktop'
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
  // This command prints one URL as the one to trust and offers to open it, so
  // preferring whichever source happened to enumerate first would quietly send
  // an operator with a local checkout AND a real deployment to localhost.
  it('refuses to guess when sources name different deployments', () => {
    expect(() =>
      resolveDeploymentUrl([source('http://localhost:3000'), source('https://sim.example.com')])
    ).toThrow(SetupError)
  })
})

describe('probeDownload', () => {
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

  // Every class that reached the terminal in an earlier round, kept as one
  // table so a regression names which one came back. Enumerating escapes cost
  // a patch per round, which is why the implementation strips whole Unicode
  // groups rather than a list.
  it.each([
    ['bidi override', '\u202e', ''],
    ['bidi isolate', '\u2066', ''],
    ['bidi mark', '\u200e', ''],
    ['arabic letter mark', '\u061c', ''],
    ['zero-width space', '\u200b', ''],
    ['byte-order mark', '\ufeff', ''],
    ['line separator', '\u2028', ' '],
    ['paragraph separator', '\u2029', ' '],
    ['no-break space', '\u00a0', ' '],
  ])('neutralizes a %s', (_name, character, expected) => {
    expect(sanitizeForTerminal(`a${character}b`)).toBe(`a${expected}b`)
  })
})
