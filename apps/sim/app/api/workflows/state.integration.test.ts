/**
 * Integration tests for workflow state persistence using REAL IRIS
 *
 * Tests the workflow state save/load cycle which is critical for execution
 *
 * @vitest-environment node
 */

import { db } from '@sim/db'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { GET as GET_BY_ID } from '@/app/api/workflows/[id]/route'
import { PUT as PUT_STATE } from '@/app/api/workflows/[id]/state/route'
import { POST } from '@/app/api/workflows/route'

// NO MOCKS ALLOWED HERE

describe('Workflow State Persistence Integration', () => {
  let testWorkspaceId: string
  let testWorkflowId: string
  const anonymousUserId = '00000000-0000-0000-0000-000000000000'

  const setupWorkspace = async () => {
    const wsId = `ws-${Date.now()}`

    // Create user if not exists
    try {
      await db.execute(
        sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (${anonymousUserId}, 'Anonymous User', 'anonymous@localhost', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
    } catch (e) {
      // Ignore user already exists
    }

    // Create workspace
    await db.execute(
      sql`INSERT INTO "workspace" (id, name, owner_id, billed_account_user_id, created_at, updated_at) VALUES (${wsId}, 'Test State Workspace', ${anonymousUserId}, ${anonymousUserId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )

    // Grant admin permission
    await db.execute(
      sql`INSERT INTO "permissions" (id, user_id, entity_kind, entity_id, permission_kind, created_at, updated_at) VALUES (${`perm-${Date.now()}`}, ${anonymousUserId}, 'workspace', ${wsId}, 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )

    await db.execute(sql`COMMIT`)

    return wsId
  }

  beforeAll(async () => {
    testWorkspaceId = await setupWorkspace()

    // Create a workflow to test state operations
    const createReq = new NextRequest('http://localhost:3000/api/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'State Test Workflow',
        workspaceId: testWorkspaceId,
      }),
    })
    const createRes = await POST(createReq)
    const createData = await createRes.json()
    testWorkflowId = createData.id
  })

  it('should save and load workflow state with blocks and edges', async () => {
    // Create a simple workflow state with two blocks connected by an edge
    const startBlockId = 'block-start-' + Date.now()
    const agentBlockId = 'block-agent-' + Date.now()
    const edgeId = 'edge-' + Date.now()

    const workflowState = {
      blocks: {
        [startBlockId]: {
          id: startBlockId,
          type: 'starter',
          name: 'Start',
          position: { x: 100, y: 100 },
          subBlocks: {
            startWorkflow: {
              id: 'startWorkflow',
              type: 'dropdown',
              value: 'manual',
            },
          },
          outputs: {},
          enabled: true,
          horizontalHandles: true,
        },
        [agentBlockId]: {
          id: agentBlockId,
          type: 'agent',
          name: 'AI Agent',
          position: { x: 400, y: 100 },
          subBlocks: {
            systemPrompt: {
              id: 'systemPrompt',
              type: 'long-input',
              value: 'You are a helpful assistant.',
            },
            model: {
              id: 'model',
              type: 'dropdown',
              value: 'gpt-4o-mini',
            },
          },
          outputs: {
            response: {
              type: { response: 'string' },
            },
          },
          enabled: true,
          horizontalHandles: true,
        },
      },
      edges: [
        {
          id: edgeId,
          source: startBlockId,
          target: agentBlockId,
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
      loops: {},
      parallels: {},
      lastSaved: Date.now(),
      isDeployed: false,
    }

    // SAVE: Save workflow state
    const saveReq = new NextRequest(`http://localhost:3000/api/workflows/${testWorkflowId}/state`, {
      method: 'PUT',
      body: JSON.stringify(workflowState),
    })
    const saveRes = await PUT_STATE(saveReq, {
      params: Promise.resolve({ id: testWorkflowId }),
    })
    const saveData = await saveRes.json()

    expect(saveRes.status).toBe(200)
    expect(saveData.success).toBe(true)

    // LOAD: Fetch workflow and verify state was persisted
    const getReq = new NextRequest(`http://localhost:3000/api/workflows/${testWorkflowId}`)
    const getRes = await GET_BY_ID(getReq, {
      params: Promise.resolve({ id: testWorkflowId }),
    })
    const getData = await getRes.json()

    expect(getRes.status).toBe(200)
    expect(getData.data).toBeDefined()
    expect(getData.data.state).toBeDefined()

    // Verify blocks were saved
    expect(getData.data.state.blocks).toBeDefined()
    expect(Object.keys(getData.data.state.blocks).length).toBe(2)

    // Verify start block
    const loadedStartBlock = getData.data.state.blocks[startBlockId]
    expect(loadedStartBlock).toBeDefined()
    expect(loadedStartBlock.type).toBe('starter')
    expect(loadedStartBlock.name).toBe('Start')
    expect(loadedStartBlock.position.x).toBe(100)
    expect(loadedStartBlock.position.y).toBe(100)

    // Verify agent block
    const loadedAgentBlock = getData.data.state.blocks[agentBlockId]
    expect(loadedAgentBlock).toBeDefined()
    expect(loadedAgentBlock.type).toBe('agent')
    expect(loadedAgentBlock.name).toBe('AI Agent')

    // Verify sub-blocks
    expect(loadedAgentBlock.subBlocks).toBeDefined()
    expect(loadedAgentBlock.subBlocks.systemPrompt).toBeDefined()
    expect(loadedAgentBlock.subBlocks.systemPrompt.value).toBe('You are a helpful assistant.')

    // Verify edges were saved
    expect(getData.data.state.edges).toBeDefined()
    expect(getData.data.state.edges.length).toBe(1)
    expect(getData.data.state.edges[0].source).toBe(startBlockId)
    expect(getData.data.state.edges[0].target).toBe(agentBlockId)
  })

  it('should update workflow state and preserve changes', async () => {
    // First fetch current state
    const getReq1 = new NextRequest(`http://localhost:3000/api/workflows/${testWorkflowId}`)
    const getRes1 = await GET_BY_ID(getReq1, {
      params: Promise.resolve({ id: testWorkflowId }),
    })
    const getData1 = await getRes1.json()

    expect(getRes1.status).toBe(200)

    // Modify a block name and add a new block
    const currentBlocks = getData1.data.state.blocks
    const blockIds = Object.keys(currentBlocks)
    const firstBlockId = blockIds[0]

    // Update the first block's name
    currentBlocks[firstBlockId].name = 'Updated Start Block'

    // Add a new block
    const newBlockId = 'block-new-' + Date.now()
    currentBlocks[newBlockId] = {
      id: newBlockId,
      type: 'function',
      name: 'New Function Block',
      position: { x: 700, y: 100 },
      subBlocks: {
        code: {
          id: 'code',
          type: 'code',
          value: 'return { result: "hello" }',
        },
      },
      outputs: {},
      enabled: true,
      horizontalHandles: true,
    }

    const updatedState = {
      ...getData1.data.state,
      blocks: currentBlocks,
      lastSaved: Date.now(),
    }

    // Save updated state
    const saveReq = new NextRequest(`http://localhost:3000/api/workflows/${testWorkflowId}/state`, {
      method: 'PUT',
      body: JSON.stringify(updatedState),
    })
    const saveRes = await PUT_STATE(saveReq, {
      params: Promise.resolve({ id: testWorkflowId }),
    })

    expect(saveRes.status).toBe(200)

    // Fetch again and verify updates
    const getReq2 = new NextRequest(`http://localhost:3000/api/workflows/${testWorkflowId}`)
    const getRes2 = await GET_BY_ID(getReq2, {
      params: Promise.resolve({ id: testWorkflowId }),
    })
    const getData2 = await getRes2.json()

    expect(getRes2.status).toBe(200)

    // Verify block count increased
    expect(Object.keys(getData2.data.state.blocks).length).toBe(3)

    // Verify the renamed block
    expect(getData2.data.state.blocks[firstBlockId].name).toBe('Updated Start Block')

    // Verify new block exists
    expect(getData2.data.state.blocks[newBlockId]).toBeDefined()
    expect(getData2.data.state.blocks[newBlockId].type).toBe('function')
    expect(getData2.data.state.blocks[newBlockId].name).toBe('New Function Block')
  })

  it('should handle empty workflow state', async () => {
    // Create a new workflow for this test
    const createReq = new NextRequest('http://localhost:3000/api/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Empty State Workflow',
        workspaceId: testWorkspaceId,
      }),
    })
    const createRes = await POST(createReq)
    const createData = await createRes.json()
    const emptyWorkflowId = createData.id

    // Fetch the workflow - should have empty state
    const getReq = new NextRequest(`http://localhost:3000/api/workflows/${emptyWorkflowId}`)
    const getRes = await GET_BY_ID(getReq, {
      params: Promise.resolve({ id: emptyWorkflowId }),
    })
    const getData = await getRes.json()

    expect(getRes.status).toBe(200)
    expect(getData.data.state).toBeDefined()
    expect(getData.data.state.blocks).toBeDefined()
    expect(Object.keys(getData.data.state.blocks).length).toBe(0)
    expect(getData.data.state.edges).toBeDefined()
    expect(getData.data.state.edges.length).toBe(0)
  })
})
