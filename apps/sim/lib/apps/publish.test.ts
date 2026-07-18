/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockTransaction,
  mockArtifactAllowed,
  updateCalls,
  deleteCalls,
  insertCalls,
  rows,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockArtifactAllowed: vi.fn(),
  updateCalls: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  deleteCalls: [] as unknown[],
  insertCalls: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  rows: {
    project: [] as Record<string, unknown>[],
    release: [] as Record<string, unknown>[],
    actions: [] as Record<string, unknown>[],
    versions: [] as Record<string, unknown>[],
    workflows: [] as Record<string, unknown>[],
  },
}))

vi.mock('@sim/db', () => ({
  db: { transaction: mockTransaction },
}))

vi.mock('@sim/db/schema', () => ({
  appBuild: { id: 'appBuild.id', buildImageDigest: 'buildImageDigest', diagnostics: 'diagnostics' },
  appDeploymentPin: { releaseId: 'appDeploymentPin.releaseId' },
  appProject: {
    id: 'appProject.id',
    archivedAt: 'appProject.archivedAt',
    version: 'appProject.version',
  },
  appRelease: {
    id: 'appRelease.id',
    projectId: 'appRelease.projectId',
    state: 'appRelease.state',
  },
  appReleaseAction: { releaseId: 'appReleaseAction.releaseId' },
  workflow: {
    id: 'workflow.id',
    workspaceId: 'workflow.workspaceId',
    archivedAt: 'workflow.archivedAt',
  },
  workflowDeploymentVersion: {
    id: 'workflowDeploymentVersion.id',
    workflowId: 'workflowDeploymentVersion.workflowId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
  isNull: vi.fn((field: unknown) => ({ field, isNull: true })),
  sql: vi.fn(() => 'version + 1'),
}))

vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'pin-id') }))
vi.mock('@/lib/apps/origin', () => ({
  getAppOriginStatus: () => ({ enabled: true, appPublicOrigin: 'https://apps.test' }),
}))
vi.mock('@/lib/apps/release-artifact-policy', () => ({
  assertReleaseArtifactAllowed: mockArtifactAllowed,
}))
vi.mock('@/lib/core/config/env-flags', () => ({ isProd: false }))
vi.mock('@/lib/core/security/turnstile', () => ({ isTurnstileConfigured: () => true }))

import {
  publishPreparedRelease,
  revokeRelease,
  rollbackPublishedRelease,
} from '@/lib/apps/publish'

const schema = await import('@sim/db/schema')

function lockedRows(value: Record<string, unknown>[]) {
  return {
    where: vi.fn(() => ({
      for: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(value) })),
    })),
  }
}

function createTx() {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table === schema.appProject) return lockedRows(rows.project)
        if (table === schema.appRelease) return lockedRows(rows.release)
        if (table === schema.appReleaseAction) {
          return { where: vi.fn().mockResolvedValue(rows.actions) }
        }
        if (table === schema.workflowDeploymentVersion) {
          return { where: vi.fn().mockResolvedValue(rows.versions) }
        }
        if (table === schema.workflow) {
          return { where: vi.fn().mockResolvedValue(rows.workflows) }
        }
        throw new Error('Unexpected select table')
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateCalls.push({ table, values })
        return {
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ id: 'updated' }]),
          })),
        }
      }),
    })),
    delete: vi.fn((table: unknown) => {
      deleteCalls.push(table)
      return { where: vi.fn().mockResolvedValue([]) }
    }),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertCalls.push({ table, values })
        return Promise.resolve()
      }),
    })),
  }
}

describe('app release publishing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateCalls.length = 0
    deleteCalls.length = 0
    insertCalls.length = 0
    rows.project = []
    rows.release = []
    rows.actions = []
    rows.versions = []
    rows.workflows = []
    mockArtifactAllowed.mockResolvedValue({ ok: true })
    mockTransaction.mockImplementation(async (callback: (tx: ReturnType<typeof createTx>) => unknown) =>
      callback(createTx())
    )
  })

  it('vacates the prior current release before publishing the prepared release', async () => {
    rows.project = [{ id: 'project-1', workspaceId: 'ws-1', version: 4, publishedReleaseId: 'old' }]
    rows.release = [{ id: 'new', projectId: 'project-1', state: 'prepared', buildId: null }]
    rows.actions = [{ workflowId: 'wf-1', deploymentVersionId: 'dv-1' }]
    rows.versions = [{ id: 'dv-1', workflowId: 'wf-1' }]
    rows.workflows = [{ id: 'wf-1', workspaceId: 'ws-1', archivedAt: null }]

    await expect(
      publishPreparedRelease({ projectId: 'project-1', releaseId: 'new' })
    ).resolves.toEqual({ success: true, releaseId: 'new' })

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: schema.appRelease,
          values: expect.objectContaining({ state: 'revoked', revokedReason: 'vacated' }),
        }),
        expect.objectContaining({
          table: schema.appRelease,
          values: expect.objectContaining({ state: 'published', revokedReason: null }),
        }),
      ])
    )
    expect(deleteCalls).toContain(schema.appDeploymentPin)
  })

  it('rejects a release that is not prepared', async () => {
    rows.project = [{ id: 'project-1', workspaceId: 'ws-1', version: 1 }]
    rows.release = [{ id: 'release-1', projectId: 'project-1', state: 'published' }]

    await expect(
      publishPreparedRelease({ projectId: 'project-1', releaseId: 'release-1' })
    ).resolves.toEqual({
      success: false,
      error: 'Only prepared releases can be published',
      code: 'INVALID_STATE',
    })
    expect(updateCalls).toHaveLength(0)
  })

  it('rejects an expectedVersion conflict before loading the release', async () => {
    rows.project = [{ id: 'project-1', workspaceId: 'ws-1', version: 8 }]

    await expect(
      publishPreparedRelease({
        projectId: 'project-1',
        releaseId: 'release-1',
        expectedVersion: 7,
      })
    ).resolves.toEqual({
      success: false,
      error: 'Project version conflict',
      code: 'CONFLICT',
    })
    expect(updateCalls).toHaveLength(0)
  })

  it('manually revokes a release and returns the revoked event', async () => {
    rows.project = [{ id: 'project-1', version: 2, publishedReleaseId: 'release-1' }]
    rows.release = [{ id: 'release-1', projectId: 'project-1', state: 'published' }]

    await expect(
      revokeRelease({ projectId: 'project-1', releaseId: 'release-1' })
    ).resolves.toEqual({
      success: true,
      clearedPointer: true,
      event: {
        type: 'app.release.revoked',
        payload: { projectId: 'project-1', releaseId: 'release-1', reason: 'manual' },
      },
    })
    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        table: schema.appRelease,
        values: expect.objectContaining({ state: 'revoked', revokedReason: 'manual' }),
      })
    )
  })

  it('rejects rollback to a manually revoked release', async () => {
    rows.project = [{ id: 'project-1', workspaceId: 'ws-1', publishedReleaseId: null }]
    rows.release = [
      {
        id: 'release-1',
        projectId: 'project-1',
        state: 'revoked',
        revokedReason: 'manual',
      },
    ]

    const result = await rollbackPublishedRelease({
      projectId: 'project-1',
      targetReleaseId: 'release-1',
    })

    expect(result).toEqual(
      expect.objectContaining({ success: false, code: 'MANUAL_REVOKE_NOT_REACTIVATABLE' })
    )
  })

  it('reactivates a vacated release and vacates the current pointer', async () => {
    rows.project = [
      { id: 'project-1', workspaceId: 'ws-1', version: 3, publishedReleaseId: 'current' },
    ]
    rows.release = [
      {
        id: 'target',
        projectId: 'project-1',
        state: 'revoked',
        revokedReason: 'vacated',
        buildId: null,
        publishedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]
    rows.actions = [{ workflowId: 'wf-1', deploymentVersionId: 'dv-1' }]
    rows.versions = [{ id: 'dv-1', workflowId: 'wf-1' }]
    rows.workflows = [{ id: 'wf-1', workspaceId: 'ws-1', archivedAt: null }]

    await expect(
      rollbackPublishedRelease({ projectId: 'project-1', targetReleaseId: 'target' })
    ).resolves.toEqual({
      success: true,
      publishedReleaseId: 'target',
      revokedVacated: true,
    })
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({ state: 'revoked', revokedReason: 'vacated' }),
        }),
        expect.objectContaining({
          values: expect.objectContaining({ state: 'published', revokedReason: null }),
        }),
      ])
    )
    expect(insertCalls).toContainEqual(
      expect.objectContaining({
        table: schema.appDeploymentPin,
        values: expect.objectContaining({ releaseId: 'target', deploymentVersionId: 'dv-1' }),
      })
    )
  })
})
