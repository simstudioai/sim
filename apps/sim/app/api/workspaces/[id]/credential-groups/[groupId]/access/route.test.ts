/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))

vi.mock('@/lib/credential-groups/application/manage-access', () => ({
  readCredentialGroupAccess: {
    operation: { id: 'credential_groups.access.read' },
    execute: mocks.read,
  },
  updateCredentialGroupAccess: {
    operation: { id: 'credential_groups.access.update' },
    execute: mocks.update,
  },
}))

import { GET, PUT } from '@/app/api/workspaces/[id]/credential-groups/[groupId]/access/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = 'group-1'
const url = `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/credential-groups/${GROUP_ID}/access`
const context = { params: Promise.resolve({ id: WORKSPACE_ID, groupId: GROUP_ID }) }
const workflows = [
  { id: 'workflow-1', name: 'Support workflow' },
  { id: 'workflow-2', name: 'Finance workflow' },
]

describe('Credential Group access route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'admin-1' },
      session: { id: 'session-1' },
    })
    mocks.read.mockResolvedValue({
      revision: 1,
      allowedWorkflowIds: ['workflow-1'],
      workflows,
    })
    mocks.update.mockResolvedValue({
      revision: 2,
      allowedWorkflowIds: ['workflow-1', 'workflow-2'],
    })
  })

  it('reads the workflow-only access selection and bounded catalog', async () => {
    const request = new NextRequest(url)
    const response = await GET(request, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      revision: 1,
      allowedWorkflowIds: ['workflow-1'],
      workflows,
    })
    expect(mocks.read).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'admin-1', sessionId: 'session-1' },
      input: { assertedWorkspaceId: WORKSPACE_ID, credentialGroupId: GROUP_ID },
      request,
    })
  })

  it('updates selected workflows with optimistic revision input', async () => {
    const body = {
      expectedRevision: 1,
      allowedWorkflowIds: ['workflow-2', 'workflow-1'],
    }
    const request = new NextRequest(url, {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
    const response = await PUT(request, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      revision: 2,
      allowedWorkflowIds: ['workflow-1', 'workflow-2'],
    })
    expect(mocks.update).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'admin-1', sessionId: 'session-1' },
      input: {
        assertedWorkspaceId: WORKSPACE_ID,
        credentialGroupId: GROUP_ID,
        ...body,
      },
      request,
    })
  })

  it('authenticates before parsing a malformed body', async () => {
    mocks.getSession.mockResolvedValue(null)
    const request = new NextRequest(url, {
      method: 'PUT',
      body: '{',
      headers: { 'content-type': 'application/json' },
    })

    const response = await PUT(request, context)

    expect(response.status).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects the removed raw resource-policy document wire shape', async () => {
    const request = new NextRequest(url, {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision: 1,
        allowedWorkflowIds: [],
        document: {
          version: 1,
          resource: { type: 'credential_group', id: GROUP_ID },
          statements: [],
        },
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PUT(request, context)

    expect(response.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects duplicate workflow selections at the HTTP boundary', async () => {
    const request = new NextRequest(url, {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision: 1,
        allowedWorkflowIds: ['workflow-1', 'workflow-1'],
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PUT(request, context)

    expect(response.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects an oversized access payload before parsing it', async () => {
    const body = JSON.stringify({
      expectedRevision: 1,
      allowedWorkflowIds: [],
      padding: 'x'.repeat(40_000),
    })
    const request = new NextRequest(url, {
      method: 'PUT',
      body,
      headers: {
        'content-length': String(Buffer.byteLength(body)),
        'content-type': 'application/json',
      },
    })

    const response = await PUT(request, context)

    expect(response.status).toBe(413)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
