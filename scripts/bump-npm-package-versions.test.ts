import { describe, expect, it } from 'vitest'
import {
  isMissingNpmPackageError,
  resolveNextStableVersion,
  updateLockfileWorkspaceVersion,
} from './bump-npm-package-versions'

describe('resolveNextStableVersion', () => {
  it('increments the highest published stable patch and ignores prereleases', () => {
    expect(
      resolveNextStableVersion('2.1.2', [
        '2.1.3-preview.10.1',
        '1.9.9',
        '2.1.2',
        '2.1.3-dev.11.1',
        '2.0.8',
      ])
    ).toBe('2.1.3')
  })

  it('preserves a higher unpublished manifest version', () => {
    expect(resolveNextStableVersion('3.0.0', ['2.1.2', '2.1.3-preview.10.1'])).toBe('3.0.0')
  })

  it('advances from the registry when the manifest is stale', () => {
    expect(resolveNextStableVersion('1.5.0', ['2.0.0', '2.1.2'])).toBe('2.1.3')
  })

  it('fails on a prerelease manifest or a registry without a stable version', () => {
    expect(() => resolveNextStableVersion('2.1.3-preview.1', ['2.1.2'])).toThrow(
      "Manifest version must be a stable X.Y.Z version, got '2.1.3-preview.1'"
    )
    expect(() => resolveNextStableVersion('2.1.3', ['2.1.3-preview.1'])).toThrow(
      'npm returned no published stable versions'
    )
  })

  it('preserves the manifest for an explicitly allowed initial release', () => {
    expect(
      resolveNextStableVersion('0.1.0', ['0.1.0-preview.10.1'], { allowInitialPublish: true })
    ).toBe('0.1.0')
  })
})

describe('isMissingNpmPackageError', () => {
  const missingPackageError = `
404 Not Found: https://registry.npmjs.org/sim-skills

 - 'sim-skills@latest' does not exist in this registry
`

  it('matches only the requested missing package', () => {
    expect(isMissingNpmPackageError(missingPackageError, 'sim-skills')).toBe(true)
    expect(isMissingNpmPackageError(missingPackageError, 'sim-setup')).toBe(false)
    expect(
      isMissingNpmPackageError('ConnectionRefused: view request failed to send', 'sim-skills')
    ).toBe(false)
  })
})

describe('updateLockfileWorkspaceVersion', () => {
  const lockfile = `{
  "workspaces": {
    "packages/sim-cli": {
      "name": "sim",
      "version": "2.1.2",
    },
    "packages/sim-setup": {
      "name": "sim-setup",
      "version": "1.0.2",
    },
    "packages/sim-skills": {
      "name": "sim-skills",
      "version": "0.1.0",
    },
    "packages/tsconfig": {
      "name": "@sim/tsconfig",
      "version": "1.0.0",
    },
  },
}`

  it('updates only the selected workspace', () => {
    const next = updateLockfileWorkspaceVersion(
      lockfile,
      'packages/sim-cli',
      'sim',
      '2.1.2',
      '2.1.3'
    )

    expect(next).toContain('"version": "2.1.3"')
    expect(next).toContain('"version": "1.0.2"')
    expect(next).toContain('"version": "0.1.0"')
    expect(next).not.toContain('"version": "2.1.2"')
  })

  it('updates the sim-skills workspace', () => {
    const next = updateLockfileWorkspaceVersion(
      lockfile,
      'packages/sim-skills',
      'sim-skills',
      '0.1.0',
      '0.1.1'
    )

    expect(next).toContain('"name": "sim-skills",\n      "version": "0.1.1"')
    expect(next).toContain('"version": "2.1.2"')
    expect(next).toContain('"version": "1.0.2"')
  })

  it('fails when the lockfile disagrees with the manifest', () => {
    expect(() =>
      updateLockfileWorkspaceVersion(lockfile, 'packages/sim-cli', 'sim', '2.1.1', '2.1.3')
    ).toThrow("bun.lock must contain exactly one sim@2.1.1 entry in 'packages/sim-cli'")
  })
})
