import { describe, expect, it } from 'vitest'
import {
  DESKTOP_PRERELEASE_REPOSITORY,
  DESKTOP_STABLE_RELEASE_REPOSITORY,
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

describe('selectReleaseForChannel', () => {
  const releases = [
    release('v0.5.25-dev.412'),
    release('v0.5.24'),
    release('v0.5.25-staging.2'),
    release('v0.5.23'),
    release('v0.5.26-dev.1', { draft: true }),
  ]

  it('offers stable-only to the latest channel', () => {
    expect(selectReleaseForChannel(releases, 'latest')?.tag_name).toBe('v0.5.24')
  })

  it('offers only staging builds to the staging stream', () => {
    expect(selectReleaseForChannel(releases, 'staging')?.tag_name).toBe('v0.5.25-staging.2')
  })

  it('offers only dev builds to the dev stream, never staging builds', () => {
    expect(selectReleaseForChannel(releases, 'dev')?.tag_name).toBe('v0.5.25-dev.412')
  })

  it('keeps already-published alpha and beta releases eligible during migration', () => {
    expect(selectReleaseForChannel([release('v0.5.25-alpha.412')], 'dev')?.tag_name).toBe(
      'v0.5.25-alpha.412'
    )
    expect(selectReleaseForChannel([release('v0.5.25-beta.2')], 'staging')?.tag_name).toBe(
      'v0.5.25-beta.2'
    )
  })

  it('never serves stable prod-identity builds to prerelease channels', () => {
    // Dev/staging are internal streams with their own app identity (Sim Dev /
    // Sim Staging); a stable Sim.app artifact can't be applied by those
    // shells, so a newer stable must not shadow the channel's own builds.
    const withNewStable = [...releases, release('v0.5.25')]
    expect(selectReleaseForChannel(withNewStable, 'dev')?.tag_name).toBe('v0.5.25-dev.412')
    expect(selectReleaseForChannel(withNewStable, 'staging')?.tag_name).toBe('v0.5.25-staging.2')
    expect(selectReleaseForChannel(withNewStable, 'latest')?.tag_name).toBe('v0.5.25')
  })

  it('skips stable-tagged releases flagged prerelease on the latest channel', () => {
    const flagged = [release('v0.5.25', { prerelease: true }), release('v0.5.24')]
    expect(selectReleaseForChannel(flagged, 'latest')?.tag_name).toBe('v0.5.24')
  })

  it('keeps releases missing the updater manifest eligible for candidate validation', () => {
    const withBrokenNewest = [
      release('v0.5.25-dev.413', { assets: [{ name: 'Sim-0.5.25-dev.413-universal.dmg' }] }),
      release('v0.5.25-dev.412'),
    ]
    expect(selectReleaseForChannel(withBrokenNewest, 'dev')?.tag_name).toBe('v0.5.25-dev.413')
  })
})

describe('rewriteManifestUrls', () => {
  it.each([
    ['stable', DESKTOP_STABLE_RELEASE_REPOSITORY],
    ['prerelease', DESKTOP_PRERELEASE_REPOSITORY],
  ])('rewrites relative url and path entries to absolute %s asset URLs', (_kind, repository) => {
    const manifest = [
      'version: 0.5.24',
      'files:',
      '  - url: Sim-0.5.24-universal.zip',
      '    sha512: abc',
      '    size: 123',
      'path: Sim-0.5.24-universal.zip',
      'sha512: abc',
      "releaseDate: '2026-07-23T00:00:00.000Z'",
    ].join('\n')
    const rewritten = rewriteManifestUrls(
      manifest,
      'v0.5.24',
      repository,
      new Set(['Sim-0.5.24-universal.zip'])
    )
    expect(rewritten).toContain(
      `  - url: https://github.com/${repository}/releases/download/v0.5.24/Sim-0.5.24-universal.zip`
    )
    expect(rewritten).toContain(
      `path: https://github.com/${repository}/releases/download/v0.5.24/Sim-0.5.24-universal.zip`
    )
    expect(rewritten).toContain('sha512: abc')
  })

  it('canonicalizes an expected absolute asset URL', () => {
    const manifest = '  - url: https://cdn.example.com/Sim-0.5.24-universal.zip'
    expect(
      rewriteManifestUrls(
        manifest,
        'v0.5.24',
        DESKTOP_STABLE_RELEASE_REPOSITORY,
        new Set(['Sim-0.5.24-universal.zip'])
      )
    ).toBe(
      `  - url: https://github.com/${DESKTOP_STABLE_RELEASE_REPOSITORY}/releases/download/v0.5.24/Sim-0.5.24-universal.zip`
    )
  })

  it('rejects unexpected manifest asset names', () => {
    const manifest = '  - url: https://cdn.example.com/unreviewed.zip'
    expect(
      rewriteManifestUrls(
        manifest,
        'v0.5.24',
        DESKTOP_STABLE_RELEASE_REPOSITORY,
        new Set(['Sim-0.5.24-universal.zip'])
      )
    ).toBeNull()
  })

  it('rejects an expected artifact that is absent from the release', () => {
    const manifest = '  - url: Sim-0.5.24-universal.zip'
    expect(
      rewriteManifestUrls(manifest, 'v0.5.24', DESKTOP_STABLE_RELEASE_REPOSITORY, new Set())
    ).toBeNull()
  })

  it('rejects a manifest without an updater file entry', () => {
    const manifest = ['version: 0.5.24', 'files: []', 'path: Sim-0.5.24-universal.zip'].join('\n')
    expect(
      rewriteManifestUrls(
        manifest,
        'v0.5.24',
        DESKTOP_STABLE_RELEASE_REPOSITORY,
        new Set(['Sim-0.5.24-universal.zip'])
      )
    ).toBeNull()
  })
})
