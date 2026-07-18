/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLimit, mockExecute, mockRelease } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockExecute: vi.fn(),
  mockRelease: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => ({ limit: mockLimit }) }),
        where: () => ({ limit: mockLimit }),
      }),
    }),
  },
}))
vi.mock('@sim/db/schema', () => ({
  workflowInterface: {
    identifier: 'interface.identifier',
    archivedAt: 'interface.archivedAt',
    isActive: 'interface.isActive',
  },
  workflow: {
    id: 'workflow.id',
    workspaceId: 'workflow.workspaceId',
    archivedAt: 'workflow.archivedAt',
  },
  workspace: {
    id: 'workspace.id',
    archivedAt: 'workspace.archivedAt',
  },
}))
vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))
vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: () => ({ release: mockRelease }),
  admissionRejectedResponse: () => new Response('busy', { status: 429 }),
}))
vi.mock('@/lib/core/utils/request', () => ({ generateRequestId: () => 'request-1' }))
vi.mock('@/lib/api/server', () => ({
  getValidationErrorMessage: () => 'invalid',
  parseRequest: async (
    _contract: unknown,
    request: Request,
    context: { params: Promise<{ identifier: string }> }
  ) => ({
    success: true,
    data: {
      params: await context.params,
      body: await request.json(),
    },
  }),
}))
vi.mock('@/lib/interfaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/interfaces')>()
  return {
    ...actual,
    toPublicSafeError: () => 'Something went wrong',
    toPublicSafeInputError: (message: string) => message,
  }
})
vi.mock('@/lib/interfaces/execute-public-interface', () => ({
  executePublicInterfaceAction: mockExecute,
}))

import { POST } from '@/app/api/interfaces/[identifier]/route'

const interfaceRow = {
  id: 'interface-1',
  workflowId: 'workflow-1',
  userId: 'user-1',
  authType: 'public',
  spec: { actions: [{ id: 'run' }] },
  outputConfigs: [],
}

function request() {
  return new Request('http://localhost/api/interfaces/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actionId: 'run', values: {} }),
  }) as never
}

describe('POST /api/interfaces/[identifier]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps unavailable interfaces public-safe', async () => {
    mockLimit.mockResolvedValueOnce([])

    const response = await POST(request(), {
      params: Promise.resolve({ identifier: 'demo' }),
    })

    expect(response.status).toBe(404)
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRelease).toHaveBeenCalledOnce()
  })

  it('rejects interfaces whose workflow or workspace is archived', async () => {
    mockLimit.mockResolvedValueOnce([interfaceRow]).mockResolvedValueOnce([])

    const response = await POST(request(), {
      params: Promise.resolve({ identifier: 'demo' }),
    })

    expect(response.status).toBe(404)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('preserves active-gate execution through the shared core', async () => {
    mockLimit
      .mockResolvedValueOnce([interfaceRow])
      .mockResolvedValueOnce([{ workspaceId: 'workspace-1' }])
    mockExecute.mockResolvedValue({
      success: true,
      body: { success: true, outputs: { result: 42 } },
    })

    const response = await POST(request(), {
      params: Promise.resolve({ identifier: 'demo' }),
    })

    expect(response.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        actionId: 'run',
      })
    )
  })
})
