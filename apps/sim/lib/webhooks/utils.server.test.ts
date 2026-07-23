/**
 * @vitest-environment node
 */
import { webhook, webhookPathClaim } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { findConflictingWebhookPathOwner } from '@/lib/webhooks/utils.server'

afterAll(resetDbChainMock)

describe('findConflictingWebhookPathOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns the claim owner while the claim holder is mid-rotation', async () => {
    queueTableRows(webhookPathClaim, [{ workflowId: 'workflow-owner' }])

    const owner = await findConflictingWebhookPathOwner({
      path: ' /leads/ ',
      workflowId: 'workflow-caller',
    })

    expect(owner).toBe('workflow-owner')
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'eq', right: 'leads' })
    )
  })

  it('ignores the caller-owned claim and falls through to live rows', async () => {
    queueTableRows(webhookPathClaim, [{ workflowId: 'workflow-caller' }])
    queueTableRows(webhook, [])

    const owner = await findConflictingWebhookPathOwner({
      path: 'leads',
      workflowId: 'workflow-caller',
    })

    expect(owner).toBeNull()
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
  })

  it('returns a foreign live-row owner when no claim exists', async () => {
    queueTableRows(webhookPathClaim, [])
    queueTableRows(webhook, [{ workflowId: 'workflow-caller' }, { workflowId: 'workflow-foreign' }])

    const owner = await findConflictingWebhookPathOwner({
      path: 'leads',
      workflowId: 'workflow-caller',
    })

    expect(owner).toBe('workflow-foreign')
  })

  it('skips the claim lookup entirely for empty paths', async () => {
    queueTableRows(webhook, [])

    const owner = await findConflictingWebhookPathOwner({
      path: '   ',
      workflowId: 'workflow-caller',
    })

    expect(owner).toBeNull()
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
  })
})
