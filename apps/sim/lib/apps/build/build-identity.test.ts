import { describe, expect, it } from 'vitest'
import {
  buildIdentityMatches,
  computeLocalViteBuildImageDigest,
  currentE2BBuildIdentity,
  isLocalViteBuildImageDigest,
} from '@/lib/apps/build/build-identity'
import { currentLocalViteBuildIdentity } from '@/lib/apps/build/local-toolchain'

describe('build identity', () => {
  it('requires exact identity fields including image digest', () => {
    const current = currentLocalViteBuildIdentity()
    expect(isLocalViteBuildImageDigest(current.buildImageDigest)).toBe(true)
    expect(current.buildImageDigest).toBe(computeLocalViteBuildImageDigest(current.lockfileHash))

    expect(
      buildIdentityMatches(
        {
          diagnostics: {
            templateVersion: current.templateVersion,
            sdkVersion: current.sdkVersion,
            lockfileHash: current.lockfileHash,
            mode: current.mode,
          },
          buildImageDigest: current.buildImageDigest,
        },
        current
      )
    ).toBe(true)

    expect(
      buildIdentityMatches(
        {
          diagnostics: {
            templateVersion: current.templateVersion,
            sdkVersion: current.sdkVersion,
            mode: current.mode,
          },
          buildImageDigest: current.buildImageDigest,
        },
        current
      )
    ).toBe(false)

    expect(
      buildIdentityMatches(
        {
          diagnostics: {
            templateVersion: current.templateVersion,
            sdkVersion: current.sdkVersion,
            lockfileHash: current.lockfileHash,
            mode: current.mode,
          },
          buildImageDigest: 'local-vite:deadbeef',
        },
        current
      )
    ).toBe(false)
  })

  it('derives a stable E2B identity from the immutable image digest', () => {
    const identity = currentE2BBuildIdentity('e2b-build:build-123')
    expect(identity.mode).toBe('e2b')
    expect(identity.buildImageDigest).toBe('e2b-build:build-123')
    expect(identity.lockfileHash).toMatch(/^[0-9a-f]{64}$/)
    expect(
      buildIdentityMatches(
        {
          diagnostics: identity,
          buildImageDigest: identity.buildImageDigest,
        },
        identity
      )
    ).toBe(true)
  })
})
