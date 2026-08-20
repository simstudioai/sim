/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mocks.isFeatureEnabled }))

import { v2MetaOperations } from '@/lib/api/application/operations'
import { readV2ApiCapabilities } from '@/lib/api/application/read-v2-api-capabilities'

const personalKey: Principal = { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' }
const workspaceKey: Principal = {
  kind: 'workspace_api_key',
  workspaceId: 'workspace-1',
  keyId: 'key-2',
}

describe('readV2ApiCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isFeatureEnabled.mockResolvedValue(true)
  })

  it('reports the cohort of the rollout subject the authenticator resolved', async () => {
    const result = await readV2ApiCapabilities.execute({
      principal: personalKey,
      input: {
        rolloutUserId: 'user-1',
        keyType: 'personal',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
    })

    expect(result).toEqual({
      v2Enabled: true,
      keyType: 'personal',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    })
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith('v2-api', { userId: 'user-1' })
  })

  /**
   * The gate keys a workspace key on the workspace's billing owner as
   * rollout-only context, and the authenticator has already resolved it —
   * re-deriving it here would be the application layer reading billing to
   * answer a question authentication already answered.
   */
  it('reports a workspace key against the billing owner the authenticator carried', async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false)

    const result = await readV2ApiCapabilities.execute({
      principal: workspaceKey,
      input: { rolloutUserId: 'owner-1', keyType: 'workspace', expiresAt: null },
    })

    expect(result).toEqual({ v2Enabled: false, keyType: 'workspace', expiresAt: null })
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith('v2-api', { userId: 'owner-1' })
  })

  /**
   * `v2ApiKeyAuth` can only ever build an API-key principal, so this branch is
   * a wiring bug rather than a refusal a caller can provoke. It must not render
   * as a `403`: the operation publishes none, and a codeless one would name no
   * remedy from `FORBIDDEN_DETAIL_CODES`.
   */
  it('treats an impossible principal kind as an invariant failure, not a forbidden', async () => {
    const session: Principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }

    const error = await readV2ApiCapabilities
      .execute({
        principal: session,
        input: { rolloutUserId: 'user-1', keyType: 'personal', expiresAt: null },
      })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('meta.capabilities.read')
    expect(error).not.toHaveProperty('code', 'forbidden')
    expect(mocks.isFeatureEnabled).not.toHaveBeenCalled()
  })

  it('declares its principal policy as frozen data rather than leaving it implicit', () => {
    expect(v2MetaOperations.read).toMatchObject({
      id: 'meta.capabilities.read',
      principalKinds: ['personal_api_key', 'workspace_api_key'],
    })
    expect(Object.isFrozen(v2MetaOperations.read)).toBe(true)
    expect(Object.isFrozen(v2MetaOperations.read.principalKinds)).toBe(true)
  })
})
