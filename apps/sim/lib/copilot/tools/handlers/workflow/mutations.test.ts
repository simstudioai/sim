/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ensureWorkflowAccessMock, setWorkflowVariablesMock, recordAuditMock } = vi.hoisted(() => ({
  ensureWorkflowAccessMock: vi.fn(),
  setWorkflowVariablesMock: vi.fn(),
  recordAuditMock: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { WORKFLOW_VARIABLES_UPDATED: 'WORKFLOW_VARIABLES_UPDATED' },
  AuditResourceType: { WORKFLOW: 'WORKFLOW' },
  recordAudit: recordAuditMock,
}))

vi.mock('@sim/db', () => ({
  db: {},
  workflow: {},
}))

vi.mock('@/lib/api-key/orchestration', () => ({
  performCreateWorkspaceApiKey: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: { INTERNAL_API_SECRET: 'secret' },
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: () => 'request-1',
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getSocketServerUrl: () => 'http://socket.test',
}))

vi.mock('@/lib/workflows/executor/execute-workflow', () => ({
  executeWorkflow: vi.fn(),
}))

vi.mock('@/lib/workflows/executor/execution-state', () => ({
  getExecutionState: vi.fn(),
  getLatestExecutionState: vi.fn(),
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performCreateFolder: vi.fn(),
  performCreateWorkflow: vi.fn(),
  performDeleteFolder: vi.fn(),
  performDeleteWorkflow: vi.fn(),
  performUpdateFolder: vi.fn(),
  performUpdateWorkflow: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: vi.fn(),
  saveWorkflowToNormalizedTables: vi.fn(),
}))

vi.mock('@/lib/workflows/sanitization/json-sanitizer', () => ({
  sanitizeForCopilot: vi.fn((state) => state),
}))

vi.mock('@/lib/workflows/utils', () => ({
  listFolders: vi.fn(),
  setWorkflowVariables: setWorkflowVariablesMock,
  verifyFolderWorkspace: vi.fn(),
}))

vi.mock('@/executor/utils/errors', () => ({
  hasExecutionResult: vi.fn(() => false),
}))

vi.mock('../access', () => ({
  ensureWorkflowAccess: ensureWorkflowAccessMock,
  ensureWorkspaceAccess: vi.fn(),
  getDefaultWorkspaceId: vi.fn(),
}))

import { executeSetGlobalWorkflowVariables } from './mutations'

describe('executeSetGlobalWorkflowVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 })) as typeof fetch
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: {
        id: 'workflow-1',
        variables: {},
      },
    })
    setWorkflowVariablesMock.mockResolvedValue(undefined)
  })

  it('persists variable changes and notifies clients that workflow state changed', async () => {
    const result = await executeSetGlobalWorkflowVariables(
      {
        workflowId: 'workflow-1',
        operations: [{ operation: 'add', name: 'threshold', type: 'number', value: '5' }],
      },
      { userId: 'user-1' } as any
    )

    expect(result.success).toBe(true)
    const [, variables] = setWorkflowVariablesMock.mock.calls[0]
    expect(Object.values(variables)).toEqual([
      expect.objectContaining({
        workflowId: 'workflow-1',
        name: 'threshold',
        type: 'number',
        value: 5,
      }),
    ])
    expect(global.fetch).toHaveBeenCalledWith('http://socket.test/api/workflow-updated', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'secret',
      },
      body: JSON.stringify({ workflowId: 'workflow-1' }),
    })
    expect(recordAuditMock).toHaveBeenCalled()
  })
})
