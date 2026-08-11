/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateWorkspaceApiKey, mockGetUserEntityPermissions, mockRecordAudit } = vi.hoisted(
  () => ({
    mockCreateWorkspaceApiKey: vi.fn(),
    mockGetUserEntityPermissions: vi.fn(),
    mockRecordAudit: vi.fn(),
  })
)

vi.mock('@/lib/api-key/auth', () => ({
  createWorkspaceApiKey: mockCreateWorkspaceApiKey,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { API_KEY_CREATED: 'api_key_created' },
  AuditResourceType: { API_KEY: 'api_key' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { apiKeyGenerated: vi.fn() },
}))

import { performCreateWorkspaceApiKey } from '@/lib/api-key/orchestration'

const PARAMS = { workspaceId: 'workspace-1', userId: 'user-1', name: 'deploy-key' }

/**
 * Deploying a workflow only requires workspace `write`. A workspace API key can
 * invoke every deployed workflow in the workspace, so this chokepoint keeps key
 * creation admin-only for every caller — routes, copilot handlers, and any
 * future one that forgets its own gate.
 */
describe('performCreateWorkspaceApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateWorkspaceApiKey.mockResolvedValue({
      id: 'key-1',
      name: 'deploy-key',
      key: 'sim_plaintext_secret',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    })
  })

  it.each(['write', 'read'] as const)('refuses a %s actor', async (permission) => {
    mockGetUserEntityPermissions.mockResolvedValue(permission)

    const result = await performCreateWorkspaceApiKey(PARAMS)

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('forbidden')
    expect(mockCreateWorkspaceApiKey).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('refuses an actor with no permission on the workspace', async () => {
    mockGetUserEntityPermissions.mockResolvedValue(null)

    const result = await performCreateWorkspaceApiKey(PARAMS)

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('forbidden')
    expect(mockCreateWorkspaceApiKey).not.toHaveBeenCalled()
  })

  it('creates the key for an admin actor', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('admin')

    const result = await performCreateWorkspaceApiKey(PARAMS)

    expect(result.success).toBe(true)
    expect(result.key?.key).toBe('sim_plaintext_secret')
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith('user-1', 'workspace', 'workspace-1')
    expect(mockCreateWorkspaceApiKey).toHaveBeenCalledWith(PARAMS)
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ keyType: 'workspace' }) })
    )
  })

  it('reports a duplicate name as a conflict', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockCreateWorkspaceApiKey.mockRejectedValue(
      new Error('An API key named "deploy-key" already exists')
    )

    const result = await performCreateWorkspaceApiKey(PARAMS)

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('conflict')
  })
})
