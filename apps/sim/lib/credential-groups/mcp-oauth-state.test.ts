/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRedis, values } = vi.hoisted(() => {
  const values = new Map<string, string>()
  return {
    values,
    mockRedis: {
      set: vi.fn(async (key: string, value: string) => {
        if (values.has(key)) return null
        values.set(key, value)
        return 'OK'
      }),
      eval: vi.fn(async (_script: string, _keyCount: number, key: string) => {
        const value = values.get(key) ?? null
        values.delete(key)
        return value
      }),
      sadd: vi.fn(async () => 1),
      srem: vi.fn(async () => 1),
      pexpire: vi.fn(async () => 1),
    },
  }
})

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: vi.fn(() => mockRedis),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: vi.fn(async (value: string) => ({
    encrypted: `encrypted:${Buffer.from(value).toString('base64')}`,
  })),
  decryptSecret: vi.fn(async (value: string) => ({
    decrypted: Buffer.from(value.replace(/^encrypted:/, ''), 'base64').toString(),
  })),
}))

import { getRedisClient } from '@/lib/core/config/redis'
import {
  consumeCredentialGroupMcpOAuthAttempt,
  createCredentialGroupMcpOAuthAttempt,
  isCredentialGroupMcpOAuthState,
} from '@/lib/credential-groups/mcp-oauth-state'

describe('Credential Group MCP OAuth state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    values.clear()
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
  })

  it('encrypts bearer material and consumes an attempt exactly once', async () => {
    const state = 'mcp_cg_state-1'
    await createCredentialGroupMcpOAuthAttempt({
      state,
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      mcpServerId: 'mcp-server-1',
      codeVerifier: 'code-verifier',
      invitationToken: 'invitation-token',
    })

    const stored = [...values.values()][0]
    expect(isCredentialGroupMcpOAuthState(state)).toBe(true)
    expect(stored).not.toContain('code-verifier')
    expect(stored).not.toContain('invitation-token')
    await expect(consumeCredentialGroupMcpOAuthAttempt(state)).resolves.toMatchObject({
      state,
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      mcpServerId: 'mcp-server-1',
      codeVerifier: 'code-verifier',
      invitationToken: 'invitation-token',
    })
    await expect(consumeCredentialGroupMcpOAuthAttempt(state)).resolves.toBeNull()
  })

  it('fails closed when Redis is unavailable', async () => {
    vi.mocked(getRedisClient).mockReturnValue(null)

    await expect(
      createCredentialGroupMcpOAuthAttempt({
        state: 'mcp_cg_state-1',
        enrollmentId: 'enrollment-1',
        credentialGroupId: 'group-1',
        mcpServerId: 'mcp-server-1',
        codeVerifier: 'code-verifier',
        invitationToken: 'invitation-token',
      })
    ).rejects.toThrow('Credential Group MCP OAuth requires Redis')
  })

  it('rejects state outside the managed MCP namespace', async () => {
    await expect(
      createCredentialGroupMcpOAuthAttempt({
        state: 'ordinary-state',
        enrollmentId: 'enrollment-1',
        credentialGroupId: 'group-1',
        mcpServerId: 'mcp-server-1',
        codeVerifier: 'code-verifier',
        invitationToken: 'invitation-token',
      })
    ).rejects.toThrow('invalid prefix')
    expect(mockRedis.set).not.toHaveBeenCalled()
  })
})
