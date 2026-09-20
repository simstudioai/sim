/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  recover: vi.fn(),
  reap: vi.fn(),
}))
vi.mock('@/lib/core/outbox/service', () => ({ processOutboxEvents: mocks.process }))
vi.mock('@/lib/knowledge/documents/processing-recovery', () => ({
  recoverKnowledgeDocumentProcessing: mocks.recover,
}))
vi.mock('@/ee/workspace-forking/lib/background-work/store', () => ({
  reapStaleBackgroundWork: mocks.reap,
}))
vi.mock('@/lib/knowledge/connectors/connector-error', () => ({
  getConnectorFailureDiagnostic: () => undefined,
}))
vi.mock('@/lib/admin/invitation-operation', () => ({ adminInvitationOperationOutboxHandlers: {} }))
vi.mock('@/lib/admin/member-operation', () => ({ adminMemberOperationOutboxHandlers: {} }))
vi.mock('@/lib/billing/enterprise-owner-claim', () => ({ enterpriseOwnerClaimOutboxHandlers: {} }))
vi.mock('@/lib/billing/enterprise-provisioning', () => ({ enterpriseIssuanceOutboxHandlers: {} }))
vi.mock('@/lib/billing/organizations/membership-reconciliation', () => ({
  membershipBillingOutboxHandlers: {},
}))
vi.mock('@/lib/billing/webhooks/outbox-handlers', () => ({ billingOutboxHandlers: {} }))
vi.mock('@/lib/invitations/direct-grant', () => ({ directGrantOutboxHandlers: {} }))
vi.mock('@/lib/knowledge/application/slack-search/outbox', () => ({
  slackSearchOutboxHandlers: {},
}))
vi.mock('@/lib/knowledge/documents/processing-outbox-handler', () => ({
  knowledgeDocumentProcessingOutboxHandlers: {},
}))
vi.mock('@/lib/mothership/inbox/cleanup-outbox', () => ({ inboxCleanupOutboxHandlers: {} }))
vi.mock('@/lib/organizations/resource-cleanup', () => ({
  organizationResourceCleanupOutboxHandlers: {},
}))
vi.mock('@/ee/access-requests/lib/notifications', () => ({
  permissionAccessRequestOutboxHandlers: {},
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-live-doc-outbox', () => ({
  workspaceFileLiveDocOutboxHandlers: {},
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox', () => ({
  workspaceFileStorageCleanupOutboxHandlers: {},
}))
vi.mock('@/lib/workflows/deployment-outbox', () => ({ workflowDeploymentOutboxHandlers: {} }))
vi.mock('@/lib/workspaces/admin-move', () => ({ invitationMigrationOutboxHandlers: {} }))
vi.mock('@/lib/workspaces/operations/outbox', () => ({ workspaceOperationOutboxHandlers: {} }))
vi.mock('@/ee/workspace-forking/application/content-outbox', () => ({
  forkContentOutboxHandlers: {},
}))

import { runOutboxProcessor } from '@/lib/core/outbox/processor'

describe('outbox processor recovery', () => {
  const result = { processed: 5, retried: 1, deadLettered: 0, leaseLost: 0, reaped: 0 }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    mocks.process.mockResolvedValue(result)
    mocks.recover.mockResolvedValue(2)
    mocks.reap.mockResolvedValue(3)
  })
  afterEach(() => vi.useRealTimers())

  it('preserves the processing limits and reports independent recovery work', async () => {
    await expect(runOutboxProcessor()).resolves.toEqual({
      result,
      recoveredDocuments: 2,
      reapedBackgroundWork: 3,
    })
    expect(mocks.process).toHaveBeenCalledWith(expect.any(Object), {
      batchSize: 500,
      maxRuntimeMs: 760_000,
      minRemainingMs: 95_000,
    })
  })

  it('still reaps expired background work when document recovery fails', async () => {
    mocks.recover.mockRejectedValueOnce(new Error('document recovery unavailable'))
    await expect(runOutboxProcessor()).resolves.toEqual({
      result,
      recoveredDocuments: 0,
      reapedBackgroundWork: 3,
    })
  })

  it('retains successful delivery results when the background-work reaper fails', async () => {
    mocks.reap.mockRejectedValueOnce(new Error('reaper unavailable'))
    await expect(runOutboxProcessor()).resolves.toEqual({
      result,
      recoveredDocuments: 2,
      reapedBackgroundWork: 0,
    })
  })

  it('skips document recovery after the processing budget is exhausted', async () => {
    mocks.process.mockImplementationOnce(async () => {
      vi.advanceTimersByTime(770_000)
      return result
    })
    await expect(runOutboxProcessor()).resolves.toEqual({
      result,
      recoveredDocuments: 0,
      reapedBackgroundWork: 3,
    })
    expect(mocks.recover).not.toHaveBeenCalled()
  })

  it('propagates delivery failures to the worker instead of reporting success', async () => {
    mocks.process.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(runOutboxProcessor()).rejects.toThrow('database unavailable')
    expect(mocks.recover).not.toHaveBeenCalled()
    expect(mocks.reap).not.toHaveBeenCalled()
  })
})
