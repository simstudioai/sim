import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbSelect,
  mockTransaction,
  mockTxSelect,
  mockInsertValues,
  mockValidateActions,
  mockPermission,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxSelect: vi.fn(),
  mockInsertValues: vi.fn(),
  mockValidateActions: vi.fn(),
  mockPermission: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    transaction: mockTransaction,
  },
}))
vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'generated-id') }))
vi.mock('@/lib/apps/origin', () => ({
  getAppOriginStatus: () => ({ enabled: true, appPublicOrigin: 'https://apps.example.com' }),
}))
vi.mock('@/lib/apps/permissions', () => ({ assertAppPermission: mockPermission }))
vi.mock('@/lib/apps/publish', () => ({
  validateReleaseActionsForActivation: mockValidateActions,
}))

import { prepareProjectRelease } from '@/lib/apps/prepare-release'

const project = { id: 'project-1', workspaceId: 'workspace-1', archivedAt: null }
const revision = {
  id: 'revision-1',
  projectId: 'project-1',
  templateVersion: 'template-1',
  sdkVersion: 'sdk-1',
}
const build = {
  id: 'build-1',
  projectId: 'project-1',
  revisionId: 'revision-1',
  status: 'succeeded',
  artifactManifestHash: 'sha256:abc',
}
const actions = [
  {
    actionId: 'main',
    workflowId: 'workflow-1',
    deploymentVersionId: 'version-1',
    inputSchema: {},
    outputAllowlist: [],
    executionPolicy: 'sync',
    schemaHash: 'hash-1',
  },
]

function limited(rows: unknown[], locked = false) {
  const limit = vi.fn(async () => rows)
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => (locked ? { for: vi.fn(() => ({ limit })) } : { limit })),
    })),
  }
}

describe('prepareProjectRelease', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbSelect.mockReturnValue(limited([project]))
    mockPermission.mockResolvedValue({ ok: true })
    mockInsertValues.mockResolvedValue(undefined)
    mockTransaction.mockImplementation(async (callback) =>
      callback({
        select: mockTxSelect,
        insert: vi.fn(() => ({ values: mockInsertValues })),
      })
    )
    mockTxSelect
      .mockReturnValueOnce(limited([project], true))
      .mockReturnValueOnce(limited([revision]))
      .mockReturnValueOnce(limited([build]))
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn(async () => actions) })),
      })
  })

  it('validates deployment versions inside the locked transaction before inserting', async () => {
    mockValidateActions.mockResolvedValue({ ok: true })

    await expect(
      prepareProjectRelease({
        projectId: 'project-1',
        revisionId: 'revision-1',
        buildId: 'build-1',
        userId: 'user-1',
      })
    ).resolves.toEqual({ ok: true, releaseId: 'generated-id' })

    expect(mockValidateActions).toHaveBeenCalledWith(
      expect.objectContaining({ select: mockTxSelect }),
      { workspaceId: 'workspace-1', actions }
    )
    expect(mockInsertValues).toHaveBeenCalledTimes(2)
  })

  it('fails closed without creating a release when a bound version is missing', async () => {
    mockValidateActions.mockResolvedValue({
      ok: false,
      error: 'The workflow version no longer exists',
      code: 'DEPLOYMENT_VERSION_MISSING',
    })

    await expect(
      prepareProjectRelease({
        projectId: 'project-1',
        revisionId: 'revision-1',
        buildId: 'build-1',
        userId: 'user-1',
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'DEPLOYMENT_VERSION_MISSING',
      status: 409,
    })
    expect(mockInsertValues).not.toHaveBeenCalled()
  })
})
