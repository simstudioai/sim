/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { describe, expect, it } from 'vitest'
import { v2MetaOperations } from '@/lib/api/application/operations'
import { readV2ApiCapabilities } from '@/lib/api/application/read-v2-api-capabilities'

const personalKey: Principal = { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' }
const workspaceKey: Principal = {
  kind: 'workspace_api_key',
  workspaceId: 'workspace-1',
  keyId: 'key-2',
}

describe('readV2ApiCapabilities', () => {
  it('requires API read scope even when called without an HTTP adapter', async () => {
    const principal = {
      kind: 'oauth_access_token',
      userId: 'user-1',
      clientId: 'client-1',
      tokenId: 'token-1',
      scopes: ['offline_access'],
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    } as const

    await expect(
      readV2ApiCapabilities.execute({
        principal,
        input: { keyType: 'oauth_access_token', expiresAt: principal.expiresAt },
      })
    ).rejects.toMatchObject({ requiredScope: 'api:read' })
  })

  it('reports that v2 is available with the credential lifecycle facts', async () => {
    const result = await readV2ApiCapabilities.execute({
      principal: personalKey,
      input: {
        keyType: 'personal',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
    })

    expect(result).toEqual({
      v2Enabled: true,
      keyType: 'personal',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    })
  })

  it('reports workspace key lifecycle facts', async () => {
    const result = await readV2ApiCapabilities.execute({
      principal: workspaceKey,
      input: { keyType: 'workspace', expiresAt: null },
    })

    expect(result).toEqual({ v2Enabled: true, keyType: 'workspace', expiresAt: null })
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
        input: { keyType: 'personal', expiresAt: null },
      })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('meta.capabilities.read')
    expect(error).not.toHaveProperty('code', 'forbidden')
  })

  it('declares its principal policy as frozen data rather than leaving it implicit', () => {
    expect(v2MetaOperations.read).toMatchObject({
      id: 'meta.capabilities.read',
      principalKinds: ['personal_api_key', 'oauth_access_token', 'workspace_api_key'],
    })
    expect(Object.isFrozen(v2MetaOperations.read)).toBe(true)
    expect(Object.isFrozen(v2MetaOperations.read.principalKinds)).toBe(true)
  })
})
