/**
 * @vitest-environment node
 */
import { workflowDeploymentVersion } from '@sim/db'
import { createMinimalWorkflowState } from '@sim/testing/factories/workflow.factory'
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing/mocks/database.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'

const WORKFLOW_ID = 'wf-1'

describe('checkNeedsRedeployment', () => {
  let transactionOpen: boolean
  let draftReadWhileTransactionOpen: boolean

  beforeEach(() => {
    resetDbChainMock()
    transactionOpen = false
    draftReadWhileTransactionOpen = false

    dbChainMockFns.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      transactionOpen = true
      try {
        return await cb(dbChainMock.db)
      } finally {
        transactionOpen = false
      }
    })

    queueTableRows(workflowDeploymentVersion, [
      { id: 'version-1', state: { blocks: {} }, workspaceId: 'ws-1' },
    ])

    const deployed = createMinimalWorkflowState()
    const draft = createMinimalWorkflowState()
    draft.blocks.agent1.subBlocks.prompt.value = 'Edited after deploy'
    const draftBlocks = draft.blocks

    workflowsPersistenceUtilsMockFns.mockMaterializeDeploymentState.mockResolvedValue({
      ...deployed,
      parallels: {},
      variables: {},
    })
    workflowsPersistenceUtilsMockFns.mockLoadWorkflowDeploymentSnapshot.mockResolvedValue({
      edges: draft.edges,
      loops: {},
      parallels: {},
      variables: {},
      get blocks() {
        if (transactionOpen) draftReadWhileTransactionOpen = true
        return draftBlocks
      },
    })
  })

  it('diffs the draft against the deployment only after the snapshot transaction commits', async () => {
    await expect(checkNeedsRedeployment(WORKFLOW_ID)).resolves.toBe(true)
    expect(draftReadWhileTransactionOpen).toBe(false)
  })

  it('reports no redeploy when the workflow has no active deployment', async () => {
    resetDbChainMock()
    await expect(checkNeedsRedeployment(WORKFLOW_ID)).resolves.toBe(false)
  })
})
