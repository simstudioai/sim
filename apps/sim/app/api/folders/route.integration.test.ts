/**
 * Integration tests for folders API route using REAL IRIS
 *
 * @vitest-environment node
 */

import { db } from '@sim/db'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { GET, POST } from '@/app/api/folders/route'

// NO MOCKS ALLOWED HERE

describe('Folders API Route Integration', () => {
  let testWorkspaceId: string
  const anonymousUserId = '00000000-0000-0000-0000-000000000000' // From Better Auth anonymous mode

  const setupWorkspace = async () => {
    // Create a test workspace and grant permissions
    const wsId = `ws-${Date.now()}`

    // Use raw SQL for setup to ensure persistence in IRIS
    try {
      await db.execute(
        sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (${anonymousUserId}, 'Anonymous User', 'anonymous@localhost', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
    } catch (e) {
      // Ignore user already exists
    }

    await db.execute(
      sql`INSERT INTO "workspace" (id, name, owner_id, billed_account_user_id, created_at, updated_at) VALUES (${wsId}, 'Test Integration Workspace', ${anonymousUserId}, ${anonymousUserId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    await db.execute(
      sql`INSERT INTO "permissions" (id, user_id, entity_kind, entity_id, permission_kind, created_at, updated_at) VALUES (${`perm-${Date.now()}`}, ${anonymousUserId}, 'workspace', ${wsId}, 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )

    await db.execute(sql`COMMIT`)

    return wsId
  }

  it('should create and then list folders', async () => {
    testWorkspaceId = await setupWorkspace()

    // 1. Create a folder

    const createReq = new NextRequest(`http://localhost:3000/api/folders`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Integration Test Folder',
        workspaceId: testWorkspaceId,
        color: '#FF0000',
      }),
    })

    const createRes = await POST(createReq)
    const createData = await createRes.json()

    expect(createRes.status).toBe(200)
    expect(createData.folder.name).toBe('Integration Test Folder')
    const folderId = createData.folder.id

    // 2. List folders
    const listReq = new NextRequest(
      `http://localhost:3000/api/folders?workspaceId=${testWorkspaceId}`
    )
    const listRes = await GET(listReq)
    const listData = await listRes.json()

    expect(listRes.status).toBe(200)
    expect(listData.folders).toContainEqual(
      expect.objectContaining({
        id: folderId,
        name: 'Integration Test Folder',
      })
    )
  })

  it('should return 400 when workspaceId is missing', async () => {
    const listReq = new NextRequest(`http://localhost:3000/api/folders`)
    const listRes = await GET(listReq)
    const listData = await listRes.json()

    expect(listRes.status).toBe(400)
    expect(listData.error).toBe('Workspace ID is required')
  })
})
