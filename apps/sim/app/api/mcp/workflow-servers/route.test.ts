/**
 * @vitest-environment node
 */
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetDbChainMock,
} from '@sim/testing'
import type { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPerformCreate } = vi.hoisted(() => ({ mockPerformCreate: vi.fn() }))

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@/lib/mcp/middleware', () => ({
  readMcpJsonBodyWithLimit: (request: NextRequest) => request.json(),
  mcpBodyReadErrorResponse: () => null,
  withMcpAuth:
    () =>
    (
      handler: (
        request: NextRequest,
        context: {
          userId: string
          userName: string
          userEmail: string
          workspaceId: string
          requestId: string
        }
      ) => Promise<Response>
    ) =>
    (request: NextRequest) =>
      handler(request, {
        userId: 'user-1',
        userName: 'Test User',
        userEmail: 'test@example.com',
        workspaceId: 'workspace-1',
        requestId: 'request-1',
      }),
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateWorkflowMcpServer: mockPerformCreate,
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { POST } from '@/app/api/mcp/workflow-servers/route'

function createRequest() {
  return new Request('http://localhost:3000/api/mcp/workflow-servers?workspaceId=workspace-1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Deploy bot', workflowIds: ['workflow-1'] }),
  }) as NextRequest
}

describe('workflow MCP servers POST route — deploy.mcp capability gate', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockPerformCreate.mockResolvedValue({
      success: true,
      server: { id: 'server-1', name: 'Deploy bot' },
      addedTools: [],
    })
  })

  it('refuses to create a workflow MCP server when the group withholds deploy.mcp', async () => {
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideDeployMcp: true,
    })

    const response = await POST(createRequest(), { params: Promise.resolve({}) })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: "MCP server deployment is not available under your organization's permission group",
    })
    expect(mockPerformCreate).not.toHaveBeenCalled()
  })

  it('creates the server when a group governs the user but withholds nothing', async () => {
    resolveGroupConfigMock.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)

    const response = await POST(createRequest(), { params: Promise.resolve({}) })

    expect(response.status).toBe(201)
    expect(mockPerformCreate).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1', name: 'Deploy bot' })
    )
  })

  /** A personal workspace, or any non-enterprise organization, is governed by no group. */
  it('creates the server when no permission group governs the user', async () => {
    resolveGroupConfigMock.mockResolvedValue(null)

    const response = await POST(createRequest(), { params: Promise.resolve({}) })

    expect(response.status).toBe(201)
    expect(mockPerformCreate).toHaveBeenCalledTimes(1)
  })
})
