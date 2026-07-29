import { describe, expect, it } from 'vitest'
import {
  channelForHostname,
  channelOfVersion,
  MANIFEST_ASSET_NAME,
  rewriteManifestUrls,
  selectReleaseForChannel,
} from '@/lib/desktop/update-feed'

function release(
  tag: string,
  options?: { draft?: boolean; prerelease?: boolean; assets?: Array<{ name: string }> }
) {
  return {
    tag_name: tag,
    draft: options?.draft ?? false,
    prerelease: options?.prerelease ?? tag.includes('-'),
    assets: (options?.assets ?? [{ name: MANIFEST_ASSET_NAME }]).map((asset) => ({
      ...asset,
      browser_download_url: `https://example.com/${asset.name}`,
    })),
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

  it('offers only beta builds to the beta channel', () => {
    expect(selectReleaseForChannel(releases, 'beta')?.tag_name).toBe('v0.5.25-beta.2')
  })

  it('offers only alpha builds to the alpha channel, never beta builds', () => {
    // Dev and staging both cut prereleases of the same next core version;
    // semver ranks beta above alpha there, so cross-channel leakage would
    // put staging builds on dev clients.
    expect(selectReleaseForChannel(releases, 'alpha')?.tag_name).toBe('v0.5.25-alpha.412')
  })

  it('never serves stable prod-identity builds to prerelease channels', () => {
    // Alpha/beta are internal channels with their own app identity (Sim Dev /
    // Sim Staging); a stable Sim.app artifact can't be applied by those
    // shells, so a newer stable must not shadow the channel's own builds.
    const withNewStable = [...releases, release('v0.5.25')]
    expect(selectReleaseForChannel(withNewStable, 'alpha')?.tag_name).toBe('v0.5.25-alpha.412')
    expect(selectReleaseForChannel(withNewStable, 'beta')?.tag_name).toBe('v0.5.25-beta.2')
    expect(selectReleaseForChannel(withNewStable, 'latest')?.tag_name).toBe('v0.5.25')
  })

  it('skips stable-tagged releases flagged prerelease on the latest channel', () => {
    const flagged = [release('v0.5.25', { prerelease: true }), release('v0.5.24')]
    expect(selectReleaseForChannel(flagged, 'latest')?.tag_name).toBe('v0.5.24')
  })

  it('skips releases missing the updater manifest asset', () => {
    // A release whose build failed (or is mid-upload) must not take the
    // channel down; the previous good release keeps serving.
    const withBrokenNewest = [
      release('v0.5.25-alpha.413', { assets: [{ name: 'Sim-0.5.25-alpha.413-universal.dmg' }] }),
      release('v0.5.25-alpha.412'),
    ]
    expect(selectReleaseForChannel(withBrokenNewest, 'alpha')?.tag_name).toBe('v0.5.25-alpha.412')
  })

  it('tolerates release listings without asset data', () => {
    const bare = { tag_name: 'v0.5.24', draft: false, prerelease: false }
    expect(selectReleaseForChannel([bare], 'latest')?.tag_name).toBe('v0.5.24')
  })

  it('skips drafts and unparseable tags', () => {
    expect(selectReleaseForChannel([release('v0.5.26-alpha.1', { draft: true })], 'alpha')).toBe(
      null
    )
    expect(selectReleaseForChannel([release('nightly')], 'alpha')).toBe(null)
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
