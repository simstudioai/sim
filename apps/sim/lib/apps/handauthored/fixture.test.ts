import { afterEach, describe, expect, it } from 'vitest'
import { runAppBuild } from '@/lib/apps/build/e2b-app-build'
import {
  HAND_AUTHORED_FIXTURE_ACTIONS,
  HAND_AUTHORED_FIXTURE_FILES,
} from '@/lib/apps/handauthored/fixture'
import { appActionManifestSchema } from '@/lib/apps/manifest'

describe('hand-authored fixture', () => {
  afterEach(() => {
    process.env.APPS_ALLOW_FIXTURE_BUILDS = undefined
    process.env.APPS_ALLOW_LOCAL_VITE_BUILDS = undefined
  })

  it('has a valid action manifest wire format', () => {
    const parsed = appActionManifestSchema.safeParse(HAND_AUTHORED_FIXTURE_ACTIONS)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.[0]?.schemaHash).toBeTruthy()
    expect(parsed.data?.[0]?.outputAllowlist).toEqual([])
  })

  it('fails closed without a build backend', async () => {
    process.env.APPS_ALLOW_FIXTURE_BUILDS = undefined
    process.env.APPS_ALLOW_LOCAL_VITE_BUILDS = undefined
    const result = await runAppBuild({
      projectId: 'p1',
      revisionId: 'r1',
      files: HAND_AUTHORED_FIXTURE_FILES,
      actions: HAND_AUTHORED_FIXTURE_ACTIONS,
    })
    expect(result.success).toBe(false)
  })

  it('builds via fixture hash path when explicitly allowed', async () => {
    process.env.APPS_ALLOW_FIXTURE_BUILDS = 'true'
    process.env.APPS_ALLOW_LOCAL_VITE_BUILDS = undefined
    const result = await runAppBuild({
      projectId: 'p1',
      revisionId: 'r1',
      files: HAND_AUTHORED_FIXTURE_FILES,
      actions: HAND_AUTHORED_FIXTURE_ACTIONS,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.buildImageDigest).toBe('fixture-hash-only')
      expect(result.artifactManifestHash.startsWith('fixture:')).toBe(true)
    }
  })
})
