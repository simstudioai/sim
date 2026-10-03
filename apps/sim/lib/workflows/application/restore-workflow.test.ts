import { FolderLockedError } from '@sim/platform-authz/workflow'
import { workflowAuthzMockFns } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  restoreRecord: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/workflows/lifecycle', () => ({ restoreWorkflow: hoisted.restoreRecord }))
vi.mock('@/lib/folders/queries', () => folderQueriesMock)

import { restoreWorkflow } from '@/lib/workflows/application/restore-workflow'

const mocks = {
  ...hoisted,
  folderIndex: folderQueriesMockFns.mockLoadActiveFolderPathIndex,
}

const mockRecordAudit = auditMockFns.mockRecordAudit
const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockResolveContext = workflowContextMockFns.mockResolveArchivedWorkflowApplicationContext

const archivedWorkflow = {
  id: 'workflow-1',
  name: 'Daily digest',
  workspaceId: 'workspace-1',
  folderId: null,
  locked: false,
}

const context = {
  workflowId: 'workflow-1',
  workflow: archivedWorkflow,
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const principal = createSessionPrincipal()
const input = { workflowId: 'workflow-1' }

describe('restoreWorkflow', () => {
  beforeEach(() => {
    mockResolveContext.mockResolvedValue(context)
    mockResolvePermission.mockResolvedValue('write')
    workflowAuthzMockFns.mockAssertFolderMutable.mockResolvedValue(undefined)
    mocks.folderIndex.mockResolvedValue({ pathById: new Map() })
    mocks.restoreRecord.mockResolvedValue({
      restored: true,
      workflow: { ...archivedWorkflow, archivedAt: null },
    })
  })

  it('refuses a workflow that is not archived as a conflict', async () => {
    mocks.restoreRecord.mockResolvedValue({ restored: false, workflow: archivedWorkflow })

    await expect(restoreWorkflow.execute({ principal, input })).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('refuses a locked workflow before restoring', async () => {
    mockResolveContext.mockResolvedValue({
      ...context,
      workflow: { ...archivedWorkflow, locked: true },
    })

    await expect(restoreWorkflow.execute({ principal, input })).rejects.toMatchObject({
      code: 'locked',
    })
    expect(mocks.restoreRecord).not.toHaveBeenCalled()
  })

  it('refuses a locked destination folder before restoring', async () => {
    workflowAuthzMockFns.mockAssertFolderMutable.mockRejectedValue(
      new FolderLockedError('Folder is locked')
    )

    await expect(restoreWorkflow.execute({ principal, input })).rejects.toMatchObject({
      code: 'locked',
    })
    expect(mocks.restoreRecord).not.toHaveBeenCalled()
  })
})
