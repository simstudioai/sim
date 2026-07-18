import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertArtifactBundleReady: vi.fn(),
  isProd: false,
  getEnv: vi.fn((key: string) => {
    if (key === 'APPS_ALLOW_FIXTURE_BUILDS') return 'true'
    return undefined
  }),
}))

vi.mock('@/lib/apps/artifacts/store', () => ({
  assertArtifactBundleReady: mocks.assertArtifactBundleReady,
}))

vi.mock('@/lib/core/config/env', () => ({
  getEnv: (key: string) => mocks.getEnv(key),
  isTruthy: (v: unknown) => v === true || v === 'true' || v === '1',
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isProd() {
    return mocks.isProd
  },
}))

import { assertReleaseArtifactAllowed } from '@/lib/apps/release-artifact-policy'

describe('assertReleaseArtifactAllowed', () => {
  beforeEach(() => {
    mocks.isProd = false
    mocks.assertArtifactBundleReady.mockReset()
    mocks.assertArtifactBundleReady.mockResolvedValue({ ok: true })
  })

  it('rejects local-vite artifacts in production', async () => {
    mocks.isProd = true
    const result = await assertReleaseArtifactAllowed(`sha256:${'a'.repeat(64)}`, {
      buildImageDigest: 'local-vite:abc123',
      buildMode: 'local-vite',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('LOCAL_BUILD_NOT_ALLOWED')
    }
    expect(mocks.assertArtifactBundleReady).not.toHaveBeenCalled()
  })

  it('allows local-vite artifacts outside production when blobs are ready', async () => {
    mocks.isProd = false
    const hash = `sha256:${'b'.repeat(64)}`
    const result = await assertReleaseArtifactAllowed(hash, {
      buildImageDigest: 'local-vite:abc123',
      buildMode: 'local-vite',
    })
    expect(result.ok).toBe(true)
    expect(mocks.assertArtifactBundleReady).toHaveBeenCalledWith(hash)
  })

  it('rejects fixture artifacts in production even when the dev flag is set', async () => {
    mocks.isProd = true
    const result = await assertReleaseArtifactAllowed(`fixture:${'c'.repeat(64)}`)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('FIXTURE_BUILDS_DISABLED')
    }
  })

  it('allows verified E2B artifacts in production', async () => {
    mocks.isProd = true
    const hash = `sha256:${'d'.repeat(64)}`
    const result = await assertReleaseArtifactAllowed(hash, {
      buildImageDigest: 'e2b-build:build-123',
      buildMode: 'e2b',
    })
    expect(result.ok).toBe(true)
    expect(mocks.assertArtifactBundleReady).toHaveBeenCalledWith(hash)
  })

  it('rejects real production artifacts without an E2B build identity', async () => {
    mocks.isProd = true
    const result = await assertReleaseArtifactAllowed(`sha256:${'e'.repeat(64)}`, {
      buildImageDigest: 'unknown',
      buildMode: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('E2B_BUILD_REQUIRED')
    }
    expect(mocks.assertArtifactBundleReady).not.toHaveBeenCalled()
  })
})
