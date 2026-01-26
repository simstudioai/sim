/**
 * Integration tests for workflows API routes using REAL IRIS
 *
 * Tests workflow CRUD operations: Create, Read, Update, Delete
 * Note: These tests run sequentially to avoid exhausting the IRIS connection pool
 *
 * @vitest-environment node
 */

import { db } from '@sim/db'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { DELETE, GET as GET_BY_ID, PUT } from '@/app/api/workflows/[id]/route'
import { GET, POST } from '@/app/api/workflows/route'

// NO MOCKS ALLOWED HERE

describe('Workflows API Route Integration', () => {
  let testWorkspaceId: string
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
      sql`INSERT INTO "workspace" (id, name, owner_id, billed_account_user_id, created_at, updated_at) VALUES (${wsId}, 'Test Workflow Workspace', ${anonymousUserId}, ${anonymousUserId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
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
  })

  it('should perform full workflow CRUD lifecycle', async () => {
    // CREATE: Create a new workflow
    const createReq = new NextRequest('http://localhost:3000/api/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'CRUD Test Workflow',
        description: 'Testing CRUD operations',
        color: '#FF5733',
        workspaceId: testWorkspaceId,
      }),
    })

    const createRes = await POST(createReq)
    const createData = await createRes.json()

    expect(createRes.status).toBe(200)
    expect(createData.id).toBeDefined()
    expect(createData.name).toBe('CRUD Test Workflow')
    expect(createData.description).toBe('Testing CRUD operations')
    expect(createData.color).toBe('#FF5733')
    const workflowId = createData.id

    // LIST: Verify workflow appears in list
    const listReq = new NextRequest(
      `http://localhost:3000/api/workflows?workspaceId=${testWorkspaceId}`
    )
    const listRes = await GET(listReq)
    const listData = await listRes.json()

    expect(listRes.status).toBe(200)
    expect(listData.data).toBeDefined()
    expect(Array.isArray(listData.data)).toBe(true)
    expect(listData.data.some((w: any) => w.id === workflowId)).toBe(true)

    // READ: Fetch single workflow by ID
    const getReq = new NextRequest(`http://localhost:3000/api/workflows/${workflowId}`)
    const getRes = await GET_BY_ID(getReq, { params: Promise.resolve({ id: workflowId }) })
    const getData = await getRes.json()

    expect(getRes.status).toBe(200)
    expect(getData.data).toBeDefined()
    expect(getData.data.id).toBe(workflowId)
    expect(getData.data.name).toBe('CRUD Test Workflow')
    expect(getData.data.state).toBeDefined()
    expect(getData.data.state.blocks).toBeDefined()
    expect(getData.data.state.edges).toBeDefined()

    // UPDATE: Update workflow metadata
    const updateReq = new NextRequest(`http://localhost:3000/api/workflows/${workflowId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Updated Workflow Name',
        description: 'Updated description',
        color: '#00FF00',
      }),
    })
    const updateRes = await PUT(updateReq, { params: Promise.resolve({ id: workflowId }) })
    const updateData = await updateRes.json()

    expect(updateRes.status).toBe(200)
    expect(updateData.workflow).toBeDefined()
    expect(updateData.workflow.name).toBe('Updated Workflow Name')
    expect(updateData.workflow.description).toBe('Updated description')
    expect(updateData.workflow.color).toBe('#00FF00')

    // Create a second workflow so we can delete the first one
    // (can't delete the only workflow in a workspace)
    const create2Req = new NextRequest('http://localhost:3000/api/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Second Workflow',
        workspaceId: testWorkspaceId,
      }),
    })
    await POST(create2Req)

    // DELETE: Delete the first workflow
    const deleteReq = new NextRequest(`http://localhost:3000/api/workflows/${workflowId}`, {
      method: 'DELETE',
    })
    const deleteRes = await DELETE(deleteReq, { params: Promise.resolve({ id: workflowId }) })
    const deleteData = await deleteRes.json()

    expect(deleteRes.status).toBe(200)
    expect(deleteData.success).toBe(true)

    // VERIFY DELETED: Confirm workflow no longer exists
    const verifyReq = new NextRequest(`http://localhost:3000/api/workflows/${workflowId}`)
    const verifyRes = await GET_BY_ID(verifyReq, { params: Promise.resolve({ id: workflowId }) })

    expect(verifyRes.status).toBe(404)
  })

  it('should create workflow with default values', async () => {
    const createReq = new NextRequest('http://localhost:3000/api/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Minimal Workflow',
        workspaceId: testWorkspaceId,
      }),
    })

    const createRes = await POST(createReq)
    const createData = await createRes.json()

    expect(createRes.status).toBe(200)
    expect(createData.name).toBe('Minimal Workflow')
    expect(createData.description).toBe('') // default
    expect(createData.color).toBe('#3972F6') // default
  })

  it('should reject workflow creation without name', async () => {
    const createReq = new NextRequest('http://localhost:3000/api/workflows', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
      }),
    })

    const createRes = await POST(createReq)
    expect(createRes.status).toBe(400)
  })

  it('should return 404 for non-existent workspace', async () => {
    const listReq = new NextRequest(
      'http://localhost:3000/api/workflows?workspaceId=non-existent-workspace'
    )
    const listRes = await GET(listReq)

    expect(listRes.status).toBe(404)
  })

  it('should return 404 for non-existent workflow', async () => {
    const getReq = new NextRequest('http://localhost:3000/api/workflows/non-existent-workflow-id')
    const getRes = await GET_BY_ID(getReq, {
      params: Promise.resolve({ id: 'non-existent-workflow-id' }),
    })

    expect(getRes.status).toBe(404)
  })
})
