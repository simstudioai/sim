/** @vitest-environment node */
import { credentialGroup, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { validateBinding } = vi.hoisted(() => ({ validateBinding: vi.fn() }))
vi.mock('@/lib/knowledge/connectors/member-access', () => ({
  validateKnowledgeConnectorMembersBinding: validateBinding,
}))

import { setOrganizationAccountIndexing } from '@/lib/knowledge/connectors/organization-account-indexing'

const input = {
  organizationId: 'org-1',
  credentialGroupId: 'group-1',
  optionId: 'gmail-option',
  enabled: false,
}
const group = {
  status: 'active',
  options: [{ id: 'gmail-option', status: 'active', provider: 'gmail' }],
}
const source = {
  id: 'source-1',
  knowledgeBaseId: 'kb-1',
  status: 'active',
  memberSyncStatus: 'idle',
  sourceConfig: {},
}

describe('organization provider indexing changes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    validateBinding.mockReturnValue({ ok: true })
    queueTableRows(credentialGroup, [group])
  })

  it('pauses all bound sources in one transaction, cancels queued work and retains documents', async () => {
    queueTableRows(knowledgeConnector, [
      source,
      { ...source, id: 'source-2', memberSyncStatus: 'pending' },
    ])
    await expect(setOrganizationAccountIndexing(input)).resolves.toMatchObject({
      enabled: false,
      changed: true,
      knowledgeBaseIds: ['kb-1'],
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'paused',
        nextMemberSyncAt: null,
        memberSyncLockToken: null,
        memberSyncStatus: 'idle',
      })
    )
    expect(dbChainMockFns.update).toHaveBeenCalledExactlyOnceWith(knowledgeConnector)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    const predicates = dbChainMockFns.where.mock.calls.flatMap(([condition]) =>
      flattenMockConditions(condition)
    )
    for (const expected of [
      { type: 'eq', left: knowledgeBase.organizationId, right: 'org-1' },
      { type: 'eq', left: knowledgeBase.isSearchIndex, right: true },
      { type: 'eq', left: knowledgeConnector.credentialGroupId, right: 'group-1' },
      { type: 'eq', left: knowledgeConnector.credentialGroupOptionId, right: 'gmail-option' },
      { type: 'eq', left: knowledgeConnector.accessMode, right: 'members' },
    ])
      expect(predicates).toContainEqual(expected)
  })

  it('resumes a paused source with a fresh schedule and revalidates its member binding', async () => {
    queueTableRows(knowledgeConnector, [{ ...source, status: 'paused' }])
    await setOrganizationAccountIndexing({ ...input, enabled: true })
    expect(validateBinding).toHaveBeenCalledWith(
      expect.objectContaining({ credentialGroupOptionId: 'gmail-option', group })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active',
        nextMemberSyncAt: expect.any(Date),
        lastMemberSyncError: null,
      })
    )
  })

  it('does not write when every source already has the requested state', async () => {
    queueTableRows(knowledgeConnector, [{ ...source, status: 'paused' }])
    await expect(setOrganizationAccountIndexing(input)).resolves.toMatchObject({ changed: false })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('refuses the entire change when one source has an active run', async () => {
    queueTableRows(knowledgeConnector, [
      source,
      { ...source, id: 'source-2', memberSyncStatus: 'running' },
    ])
    await expect(setOrganizationAccountIndexing(input)).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('refuses a stale or foreign option before touching any source', async () => {
    await expect(
      setOrganizationAccountIndexing({ ...input, optionId: 'foreign-option' })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('requires setup instead of reporting indexing enabled without a source', async () => {
    queueTableRows(knowledgeConnector, [])
    await expect(setOrganizationAccountIndexing({ ...input, enabled: true })).rejects.toMatchObject(
      { code: 'not_found' }
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rejects re-enabling a source whose scopes no longer meet the ingestion requirements', async () => {
    queueTableRows(knowledgeConnector, [{ ...source, status: 'paused' }])
    validateBinding.mockReturnValue({ ok: false, message: 'Reconnect with the required scopes' })
    await expect(setOrganizationAccountIndexing({ ...input, enabled: true })).rejects.toThrow(
      'Reconnect with the required scopes'
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
