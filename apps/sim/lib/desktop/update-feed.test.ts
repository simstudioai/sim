import { describe, expect, it } from 'vitest'
import {
  channelForHostname,
  channelOfVersion,
  manifestAssetName,
  rewriteManifestUrls,
  selectReleaseForChannel,
} from '@/lib/desktop/update-feed'

function release(tag: string, options?: { draft?: boolean }) {
  return {
    tag_name: tag,
    draft: options?.draft ?? false,
    prerelease: tag.includes('-'),
  }
}

describe('channelForHostname', () => {
  it('maps hosted environments to their channels', () => {
    expect(channelForHostname('dev.sim.ai')).toBe('alpha')
    expect(channelForHostname('www.dev.sim.ai')).toBe('alpha')
    expect(channelForHostname('staging.sim.ai')).toBe('beta')
    expect(channelForHostname('www.staging.sim.ai')).toBe('beta')
    expect(channelForHostname('sim.ai')).toBe('latest')
    expect(channelForHostname('www.sim.ai')).toBe('latest')
  })

  it('defaults self-hosted and local deployments to stable', () => {
    expect(channelForHostname('sim.example.com')).toBe('latest')
    expect(channelForHostname('localhost')).toBe('latest')
  })
})

describe('channelOfVersion', () => {
  it('classifies versions by prerelease tag', () => {
    expect(channelOfVersion('0.5.24')).toBe('latest')
    expect(channelOfVersion('0.5.25-beta.3')).toBe('beta')
    expect(channelOfVersion('0.5.25-alpha.412')).toBe('alpha')
  })
})

describe('selectReleaseForChannel', () => {
  const releases = [
    release('v0.5.25-alpha.412'),
    release('v0.5.24'),
    release('v0.5.25-beta.2'),
    release('v0.5.23'),
    release('v0.5.26-alpha.1', { draft: true }),
  ]

  it('offers stable-only to the latest channel', () => {
    expect(selectReleaseForChannel(releases, 'latest')?.tag_name).toBe('v0.5.24')
  })

  it('offers beta + stable to the beta channel', () => {
    expect(selectReleaseForChannel(releases, 'beta')?.tag_name).toBe('v0.5.25-beta.2')
  })

  it('offers alpha + stable to the alpha channel, never beta builds', () => {
    // Dev and staging both cut prereleases of the same next core version;
    // semver ranks beta above alpha there, so cross-channel leakage would
    // put staging builds on dev clients.
    expect(selectReleaseForChannel(releases, 'alpha')?.tag_name).toBe('v0.5.25-alpha.412')
  })

  it('moves prerelease channels forward when a newer stable ships', () => {
    const withNewStable = [...releases, release('v0.5.25')]
    expect(selectReleaseForChannel(withNewStable, 'alpha')?.tag_name).toBe('v0.5.25')
    expect(selectReleaseForChannel(withNewStable, 'beta')?.tag_name).toBe('v0.5.25')
  })

  it('skips drafts and unparseable tags', () => {
    expect(selectReleaseForChannel([release('v0.5.26-alpha.1', { draft: true })], 'alpha')).toBe(
      null
    )
    expect(selectReleaseForChannel([release('nightly')], 'alpha')).toBe(null)
  })
})

describe('manifestAssetName', () => {
  it('matches the channel file electron-builder emits', () => {
    expect(manifestAssetName('0.5.24')).toBe('latest-mac.yml')
    expect(manifestAssetName('0.5.25-beta.2')).toBe('beta-mac.yml')
    expect(manifestAssetName('0.5.25-alpha.412')).toBe('alpha-mac.yml')
  })
})

describe('rewriteManifestUrls', () => {
  it('rewrites relative url and path entries to absolute asset URLs', () => {
    const manifest = [
      'version: 0.5.24',
      'files:',
      '  - url: Sim-0.5.24-universal-mac.zip',
      '    sha512: abc',
      '    size: 123',
      'path: Sim-0.5.24-universal-mac.zip',
      'sha512: abc',
      "releaseDate: '2026-07-23T00:00:00.000Z'",
    ].join('\n')
    const rewritten = rewriteManifestUrls(manifest, 'v0.5.24')
    expect(rewritten).toContain(
      '  - url: https://github.com/simstudioai/sim/releases/download/v0.5.24/Sim-0.5.24-universal-mac.zip'
    )
    expect(rewritten).toContain(
      'path: https://github.com/simstudioai/sim/releases/download/v0.5.24/Sim-0.5.24-universal-mac.zip'
    )
    expect(rewritten).toContain('sha512: abc')
  })

  it('leaves already-absolute URLs alone', () => {
    const manifest = '  - url: https://cdn.example.com/Sim.zip'
    expect(rewriteManifestUrls(manifest, 'v0.5.24')).toBe(manifest)
  })
})
