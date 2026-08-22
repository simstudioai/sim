/**
 * @vitest-environment node
 */
import { credential, environment, workspaceEnvironment } from '@sim/db/schema'
import {
  dbChainMockFns,
  encryptionMock,
  encryptionMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { or } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckWorkspaceAccess } = vi.hoisted(() => ({
  mockCheckWorkspaceAccess: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

import {
  CopilotCodeSecretAccessError,
  MAX_SECRET_MOUNT_NAME_LENGTH,
  MAX_SECRET_MOUNT_NAMES,
  materializeCopilotCodeSecrets,
} from '@/lib/copilot/tools/secret-mount-materializer.server'

interface CredentialRow {
  type: 'env_personal' | 'env_workspace'
  envKey: string
  envOwnerUserId: string | null
  role: 'admin' | 'member' | null
  status: 'active' | 'pending' | 'revoked' | null
  updatedAt: Date
  encryptedValue: string | null
  encryptedValueBytes: number | null
}

function queueSources(input: {
  personal?: Record<string, string>
  personalOverLimit?: string[]
  workspace?: Record<string, string>
  workspaceOverLimit?: string[]
  credentials?: CredentialRow[]
}): void {
  queueTableRows(environment, [
    { variables: input.personal ?? {}, overLimitNames: input.personalOverLimit ?? [] },
  ])
  queueTableRows(workspaceEnvironment, [
    { variables: input.workspace ?? {}, overLimitNames: input.workspaceOverLimit ?? [] },
  ])
  queueTableRows(credential, input.credentials ?? [])
}

function credentialRow(
  overrides: Partial<CredentialRow> & Pick<CredentialRow, 'envKey' | 'type'>
): CredentialRow {
  return {
    envOwnerUserId: null,
    role: null,
    status: null,
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    encryptedValue: null,
    encryptedValueBytes: null,
    ...overrides,
  }
}

function mockSqlText(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('toSQL' in value)) {
    throw new Error('Expected a mock SQL fragment')
  }
  const toSQL = value.toSQL
  if (typeof toSQL !== 'function') throw new Error('Expected a mock SQL renderer')
  const rendered = toSQL.call(value) as { sql?: unknown }
  if (typeof rendered.sql !== 'string') throw new Error('Expected rendered SQL text')
  return rendered.sql
}

describe('materializeCopilotCodeSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      canAdmin: false,
    })
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: `plain:${encryptedValue}`,
    }))
  })

  it('mounts the actor own personal secret', async () => {
    queueSources({ personal: { API_KEY: 'personal-cipher' } })

    await expect(
      materializeCopilotCodeSecrets({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        requestedNames: ['API_KEY'],
      })
    ).resolves.toEqual({
      envVars: { API_KEY: 'plain:personal-cipher' },
      catalogEntries: [
        {
          name: 'API_KEY',
          plaintext: 'plain:personal-cipher',
          encryptedValue: 'personal-cipher',
          scope: 'personal',
          ownerUserId: 'user-1',
        },
      ],
    })
  })

  it('scopes a workspace-authorized secret to the workspace', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      canAdmin: true,
    })
    queueSources({ workspace: { API_KEY: 'workspace-cipher' } })

    const result = await materializeCopilotCodeSecrets({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      requestedNames: ['API_KEY'],
    })

    expect(result.catalogEntries).toEqual([
      {
        name: 'API_KEY',
        plaintext: 'plain:workspace-cipher',
        encryptedValue: 'workspace-cipher',
        scope: 'workspace',
      },
    ])
  })

  it('mounts an own __proto__ secret as data without mutating record prototypes', async () => {
    queueSources({ personal: Object.fromEntries([['__proto__', 'personal-cipher']]) })

    const result = await materializeCopilotCodeSecrets({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      requestedNames: ['__proto__'],
    })

    expect(Object.hasOwn(result.envVars, '__proto__')).toBe(true)
    expect(result.envVars.__proto__).toBe('plain:personal-cipher')
    expect(Object.getPrototypeOf(result.envVars)).toBe(Object.prototype)
  })

  it('casts stored JSON values before using JSONB operators', async () => {
    queueSources({ personal: { API_KEY: 'personal-cipher' } })

    await materializeCopilotCodeSecrets({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      requestedNames: ['API_KEY'],
    })

    for (const [selection] of dbChainMockFns.select.mock.calls.slice(0, 2)) {
      const fields = selection as Record<string, unknown>
      expect(mockSqlText(fields.variables)).toContain("coalesce(?::jsonb, '{}'::jsonb)")
      expect(mockSqlText(fields.overLimitNames)).toContain("coalesce(?::jsonb, '{}'::jsonb)")
    }

    const personalCredentialPredicate = vi.mocked(or).mock.calls[0]?.[1]
    expect(mockSqlText(personalCredentialPredicate)).toContain(
      "coalesce(?::jsonb, '{}'::jsonb) ? ?"
    )
  })

  it('lets a workspace admin mount workspace secrets with workspace precedence', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      canAdmin: true,
    })
    queueSources({
      personal: { API_KEY: 'personal-cipher' },
      workspace: { API_KEY: 'workspace-cipher' },
    })

    const result = await materializeCopilotCodeSecrets({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      requestedNames: ['API_KEY'],
    })

    expect(result.envVars).toEqual({ API_KEY: 'plain:workspace-cipher' })
  })

  it('lets an active per-secret admin mount a workspace secret', async () => {
    queueSources({
      workspace: { API_KEY: 'workspace-cipher' },
      credentials: [
        credentialRow({
          type: 'env_workspace',
          envKey: 'API_KEY',
          role: 'admin',
          status: 'active',
        }),
      ],
    })

    const result = await materializeCopilotCodeSecrets({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      requestedNames: ['API_KEY'],
    })

    expect(result.envVars).toEqual({ API_KEY: 'plain:workspace-cipher' })
  })

  it.each([
    ['member', 'active'],
    ['admin', 'revoked'],
    ['admin', 'pending'],
  ] as const)('denies a workspace secret for a %s/%s credential grant', async (role, status) => {
    queueSources({
      workspace: { API_KEY: 'workspace-cipher' },
      credentials: [credentialRow({ type: 'env_workspace', envKey: 'API_KEY', role, status })],
    })

    await expect(
      materializeCopilotCodeSecrets({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        requestedNames: ['API_KEY'],
      })
    ).rejects.toBeInstanceOf(CopilotCodeSecretAccessError)
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('denies workspace secrets when the actor has zero credential grants', async () => {
    queueSources({ workspace: { API_KEY: 'workspace-cipher' }, credentials: [] })

    await expect(
      materializeCopilotCodeSecrets({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        requestedNames: ['API_KEY'],
      })
    ).rejects.toThrow('Copilot code cannot access the requested secret: API_KEY')
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('lets an authorized personal value win over an unauthorized same-name workspace value', async () => {
    queueSources({
      personal: { API_KEY: 'personal-cipher' },
      workspace: { API_KEY: 'workspace-cipher' },
      credentials: [
        credentialRow({
          type: 'env_workspace',
          envKey: 'API_KEY',
          role: 'member',
          status: 'active',
        }),
      ],
    })

    const result = await materializeCopilotCodeSecrets({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      requestedNames: ['API_KEY'],
    })

    expect(result.envVars).toEqual({ API_KEY: 'plain:personal-cipher' })
  })

  it('lets an authorized personal value win over an unauthorized over-limit workspace value', async () => {
    queueSources({
      personal: { API_KEY: 'personal-cipher' },
      workspaceOverLimit: ['API_KEY'],
      credentials: [
        credentialRow({
          type: 'env_workspace',
          envKey: 'API_KEY',
          role: 'member',
          status: 'active',
        }),
      ],
    })

    const result = await materializeCopilotCodeSecrets({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      requestedNames: ['API_KEY'],
    })

    expect(result.envVars).toEqual({ API_KEY: 'plain:personal-cipher' })
  })

  it('does not fall back when an authorized workspace value exceeds the encrypted byte limit', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      canAdmin: true,
    })
    queueSources({
      personal: { API_KEY: 'personal-cipher' },
      workspaceOverLimit: ['API_KEY'],
    })

    await expect(
      materializeCopilotCodeSecrets({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        requestedNames: ['API_KEY'],
      })
    ).rejects.toThrow('Requested secrets exceed the Copilot mount size limit')
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('does not fall back when the actor own personal value exceeds the encrypted byte limit', async () => {
    queueSources({
      personalOverLimit: ['API_KEY'],
      credentials: [
        credentialRow({
          type: 'env_personal',
          envKey: 'API_KEY',
          envOwnerUserId: 'owner-2',
          role: 'admin',
          status: 'active',
          encryptedValue: 'shared-cipher',
          encryptedValueBytes: 13,
        }),
      ],
    })

    await expect(
      materializeCopilotCodeSecrets({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        requestedNames: ['API_KEY'],
      })
    ).rejects.toThrow('Requested secrets exceed the Copilot mount size limit')
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('mounts another owner personal secret only for an active per-secret admin', async () => {
    queueSources({
      credentials: [
        credentialRow({
          type: 'env_personal',
          envKey: 'SHARED_KEY',
          envOwnerUserId: 'owner-2',
          role: 'admin',
          status: 'active',
          encryptedValue: 'shared-cipher',
          encryptedValueBytes: 13,
        }),
      ],
    })

    const result = await materializeCopilotCodeSecrets({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      requestedNames: ['SHARED_KEY'],
    })

    expect(result.envVars).toEqual({ SHARED_KEY: 'plain:shared-cipher' })
    /**
     * The usage trail is read per owner, so a borrowed secret has to be filed under the
     * sharer. Attributing it to the actor would surface it under the actor's own
     * same-named secret and hide it from the person who can actually rotate it.
     */
    expect(result.catalogEntries).toEqual([
      expect.objectContaining({ name: 'SHARED_KEY', scope: 'personal', ownerUserId: 'owner-2' }),
    ])
  })

  it('uses the current encrypted value on every call so rotation is observed', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      canAdmin: true,
    })
    queueSources({ workspace: { API_KEY: 'rotated-cipher' } })

    const result = await materializeCopilotCodeSecrets({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      requestedNames: ['API_KEY'],
    })

    expect(result.envVars).toEqual({ API_KEY: 'plain:rotated-cipher' })
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledWith('rotated-cipher')
  })

  it('fails atomically for missing or deleted names before decrypting authorized values', async () => {
    queueSources({ personal: { ALLOWED: 'allowed-cipher' } })

    await expect(
      materializeCopilotCodeSecrets({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        requestedNames: ['ALLOWED', 'DELETED'],
      })
    ).rejects.toThrow('Copilot code cannot access the requested secret: DELETED')
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('fails the whole call when decryption fails', async () => {
    queueSources({ personal: { API_KEY: 'broken-cipher' } })
    encryptionMockFns.mockDecryptSecret.mockRejectedValue(new Error('decrypt failed'))

    await expect(
      materializeCopilotCodeSecrets({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        requestedNames: ['API_KEY'],
      })
    ).rejects.toThrow('One or more requested secrets could not be decrypted')
  })

  it('fails the whole call when mounted plaintext exceeds the byte budget', async () => {
    queueSources({ personal: { API_KEY: 'large-cipher' } })
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'x'.repeat(64 * 1024 + 1) })

    await expect(
      materializeCopilotCodeSecrets({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        requestedNames: ['API_KEY'],
      })
    ).rejects.toThrow('Requested secrets exceed the Copilot mount size limit')
  })

  it('fails the whole call when an authorized shared personal ciphertext exceeds the byte limit', async () => {
    queueSources({
      credentials: [
        credentialRow({
          type: 'env_personal',
          envKey: 'API_KEY',
          envOwnerUserId: 'owner-2',
          role: 'admin',
          status: 'active',
          encryptedValueBytes: 512 * 1024 + 1,
        }),
      ],
    })

    await expect(
      materializeCopilotCodeSecrets({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        requestedNames: ['API_KEY'],
      })
    ).rejects.toThrow('Requested secrets exceed the Copilot mount size limit')
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('rejects over-limit requests before access checks, database reads, or decryption', async () => {
    const requestedNames = Array.from(
      { length: MAX_SECRET_MOUNT_NAMES + 1 },
      (_, index) => `SECRET_${index}`
    )

    await expect(
      materializeCopilotCodeSecrets({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        requestedNames,
      })
    ).rejects.toThrow(`at most ${MAX_SECRET_MOUNT_NAMES} secrets`)
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('rejects overlong names before access checks, database reads, or decryption', async () => {
    await expect(
      materializeCopilotCodeSecrets({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        requestedNames: ['S'.repeat(MAX_SECRET_MOUNT_NAME_LENGTH + 1)],
      })
    ).rejects.toThrow(`at most ${MAX_SECRET_MOUNT_NAME_LENGTH} characters`)
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })
})
