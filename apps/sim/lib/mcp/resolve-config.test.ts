/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetEffectiveEnvironmentSnapshot } = vi.hoisted(() => ({
  mockGetEffectiveEnvironmentSnapshot: vi.fn(),
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveEnvironmentSnapshot: mockGetEffectiveEnvironmentSnapshot,
}))

import { resolveMcpConfigEnvVars } from '@/lib/mcp/resolve-config'

const BASE_CONFIG = {
  id: 'server-1',
  name: 'Server',
  transport: 'streamable-http' as const,
  url: 'https://{{MCP_HOST}}/mcp',
  headers: {
    Authorization: 'Bearer {{MCP_TOKEN}}',
    'X-Direct': 'literal-secret',
  },
}

describe('resolveMcpConfigEnvVars secret provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: {
        MCP_HOST: 'personal-host-encrypted',
        MCP_TOKEN: 'personal-token-encrypted',
        UNUSED: 'unused-encrypted',
      },
      workspaceEncrypted: { MCP_TOKEN: 'workspace-token-encrypted' },
      personalDecrypted: {
        MCP_HOST: 'api.example.com',
        MCP_TOKEN: 'personal-token',
        UNUSED: 'literal-secret',
      },
      workspaceDecrypted: { MCP_TOKEN: 'workspace-token' },
      conflicts: ['MCP_TOKEN'],
      decryptionFailures: [],
    })
  })

  it('returns encrypted provenance only for successful {{NAME}} substitutions', async () => {
    const result = await resolveMcpConfigEnvVars(BASE_CONFIG, 'user-1', 'workspace-1')

    expect(result.config.url).toBe('https://api.example.com/mcp')
    expect(result.config.headers).toEqual({
      Authorization: 'Bearer workspace-token',
      'X-Direct': 'literal-secret',
    })
    expect(result.resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [
        { name: 'MCP_HOST', encryptedValue: 'personal-host-encrypted' },
        { name: 'MCP_TOKEN', encryptedValue: 'workspace-token-encrypted' },
      ],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(JSON.stringify(result.resolvedSecretTraceProvenance)).not.toContain('workspace-token"')
    expect(JSON.stringify(result.resolvedSecretTraceProvenance)).not.toContain('literal-secret')
  })

  it('marks provenance incomplete when a resolved value has no encrypted catalog entry', async () => {
    mockGetEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: { MCP_HOST: 'api.example.com', MCP_TOKEN: 'token' },
      workspaceDecrypted: {},
      conflicts: [],
      decryptionFailures: [],
    })

    const result = await resolveMcpConfigEnvVars(BASE_CONFIG, 'user-1', 'workspace-1')

    expect(result.resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
  })

  it('does not let an unused configured-secret failure affect invocation provenance', async () => {
    mockGetEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: {
        MCP_HOST: 'host-encrypted',
        MCP_TOKEN: 'token-encrypted',
        UNUSED: 'broken-encrypted',
      },
      workspaceEncrypted: {},
      personalDecrypted: {
        MCP_HOST: 'api.example.com',
        MCP_TOKEN: 'token',
        UNUSED: '',
      },
      workspaceDecrypted: {},
      conflicts: [],
      decryptionFailures: ['UNUSED'],
    })

    const result = await resolveMcpConfigEnvVars(BASE_CONFIG, 'user-1', 'workspace-1')

    expect(result.resolvedSecretTraceProvenance.complete).toBe(true)
    expect(result.resolvedSecretTraceProvenance.entries).toHaveLength(2)
  })

  it('reports successful substitutions before strict missing-reference failure', async () => {
    const onProvenance = vi.fn()
    const config = {
      ...BASE_CONFIG,
      headers: {
        Authorization: 'Bearer {{MCP_TOKEN}}',
        'X-Missing': '{{NOT_CONFIGURED}}',
      },
    }

    await expect(
      resolveMcpConfigEnvVars(config, 'user-1', 'workspace-1', {
        onResolvedSecretTraceProvenance: onProvenance,
      })
    ).rejects.toThrow('NOT_CONFIGURED')

    expect(onProvenance).toHaveBeenCalledWith({
      version: 1,
      complete: true,
      entries: [
        { name: 'MCP_HOST', encryptedValue: 'personal-host-encrypted' },
        { name: 'MCP_TOKEN', encryptedValue: 'workspace-token-encrypted' },
      ],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
  })

  it('reports incomplete provenance when the Secrets catalog cannot be loaded', async () => {
    const onProvenance = vi.fn()
    mockGetEffectiveEnvironmentSnapshot.mockRejectedValueOnce(new Error('database unavailable'))

    const result = await resolveMcpConfigEnvVars(BASE_CONFIG, 'user-1', 'workspace-1', {
      onResolvedSecretTraceProvenance: onProvenance,
    })

    const expected = {
      version: 1 as const,
      complete: false,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    }
    expect(result.resolvedSecretTraceProvenance).toEqual(expected)
    expect(onProvenance).toHaveBeenCalledWith(expected)
    expect(result.config).toEqual(BASE_CONFIG)
  })

  it('uses one atomic cached snapshot for runtime values and encrypted provenance', async () => {
    mockGetEffectiveEnvironmentSnapshot.mockResolvedValueOnce({
      personalEncrypted: { MCP_HOST: 'old-host-ciphertext', MCP_TOKEN: 'old-token-ciphertext' },
      workspaceEncrypted: {},
      personalDecrypted: { MCP_HOST: 'old.example.com', MCP_TOKEN: 'old-token' },
      workspaceDecrypted: {},
      conflicts: [],
      decryptionFailures: [],
    })

    const result = await resolveMcpConfigEnvVars(BASE_CONFIG, 'user-1', 'workspace-1')

    expect(mockGetEffectiveEnvironmentSnapshot).toHaveBeenCalledOnce()
    expect(mockGetEffectiveEnvironmentSnapshot).toHaveBeenCalledWith('user-1', 'workspace-1')
    expect(result.config).toMatchObject({
      url: 'https://old.example.com/mcp',
      headers: expect.objectContaining({ Authorization: 'Bearer old-token' }),
    })
    expect(result.resolvedSecretTraceProvenance.entries).toEqual([
      { name: 'MCP_HOST', encryptedValue: 'old-host-ciphertext' },
      { name: 'MCP_TOKEN', encryptedValue: 'old-token-ciphertext' },
    ])
  })
})
