/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOperations = vi.hoisted(() => ({
  executeSsmCancelCommand: vi.fn(),
  executeSsmDeleteParameter: vi.fn(),
  executeSsmDescribeAutomationExecutions: vi.fn(),
  executeSsmDescribeInstanceInformation: vi.fn(),
  executeSsmDescribeInstancePatchStates: vi.fn(),
  executeSsmDescribeInstancePatches: vi.fn(),
  executeSsmDescribeParameters: vi.fn(),
  executeSsmGetAutomationExecution: vi.fn(),
  executeSsmGetCommandInvocation: vi.fn(),
  executeSsmGetDocument: vi.fn(),
  executeSsmGetParameter: vi.fn(),
  executeSsmGetParameters: vi.fn(),
  executeSsmGetParametersByPath: vi.fn(),
  executeSsmListCommandInvocations: vi.fn(),
  executeSsmListCommands: vi.fn(),
  executeSsmListComplianceItems: vi.fn(),
  executeSsmListComplianceSummaries: vi.fn(),
  executeSsmListDocuments: vi.fn(),
  executeSsmPutParameter: vi.fn(),
  executeSsmSendCommand: vi.fn(),
  executeSsmStartAutomationExecution: vi.fn(),
  executeSsmStopAutomationExecution: vi.fn(),
}))

vi.mock('@/lib/internal/ssm/operations', () => mockOperations)

import { executeSsmTool } from '@/lib/internal/ssm/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

const COMMAND_ID = '11111111-2222-3333-4444-555555555555'
const INSTANCE_ID = 'i-0123456789abcdef0'

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'ssm_list_commands',
    input: CONNECTION,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const TOOL_CASES = [
  {
    toolId: 'ssm_send_command',
    input: { ...CONNECTION, documentName: 'AWS-RunShellScript', instanceIds: [INSTANCE_ID] },
    operation: mockOperations.executeSsmSendCommand,
  },
  {
    toolId: 'ssm_list_commands',
    input: CONNECTION,
    operation: mockOperations.executeSsmListCommands,
  },
  {
    toolId: 'ssm_list_command_invocations',
    input: { ...CONNECTION, commandId: COMMAND_ID },
    operation: mockOperations.executeSsmListCommandInvocations,
  },
  {
    toolId: 'ssm_get_command_invocation',
    input: { ...CONNECTION, commandId: COMMAND_ID, instanceId: INSTANCE_ID },
    operation: mockOperations.executeSsmGetCommandInvocation,
  },
  {
    toolId: 'ssm_cancel_command',
    input: { ...CONNECTION, commandId: COMMAND_ID },
    operation: mockOperations.executeSsmCancelCommand,
  },
  {
    toolId: 'ssm_get_parameter',
    input: { ...CONNECTION, name: '/prod/app/database-url' },
    operation: mockOperations.executeSsmGetParameter,
  },
  {
    toolId: 'ssm_get_parameters',
    input: { ...CONNECTION, names: ['/prod/app/database-url'] },
    operation: mockOperations.executeSsmGetParameters,
  },
  {
    toolId: 'ssm_get_parameters_by_path',
    input: { ...CONNECTION, path: '/prod/app' },
    operation: mockOperations.executeSsmGetParametersByPath,
  },
  {
    toolId: 'ssm_put_parameter',
    input: { ...CONNECTION, name: '/prod/app/database-url', value: 'postgres://example' },
    operation: mockOperations.executeSsmPutParameter,
  },
  {
    toolId: 'ssm_delete_parameter',
    input: { ...CONNECTION, name: '/prod/app/database-url' },
    operation: mockOperations.executeSsmDeleteParameter,
  },
  {
    toolId: 'ssm_describe_parameters',
    input: CONNECTION,
    operation: mockOperations.executeSsmDescribeParameters,
  },
  {
    toolId: 'ssm_describe_instance_information',
    input: CONNECTION,
    operation: mockOperations.executeSsmDescribeInstanceInformation,
  },
  {
    toolId: 'ssm_describe_instance_patches',
    input: { ...CONNECTION, instanceId: INSTANCE_ID },
    operation: mockOperations.executeSsmDescribeInstancePatches,
  },
  {
    toolId: 'ssm_describe_instance_patch_states',
    input: { ...CONNECTION, instanceIds: [INSTANCE_ID] },
    operation: mockOperations.executeSsmDescribeInstancePatchStates,
  },
  {
    toolId: 'ssm_list_compliance_items',
    input: { ...CONNECTION, resourceIds: [INSTANCE_ID] },
    operation: mockOperations.executeSsmListComplianceItems,
  },
  {
    toolId: 'ssm_list_compliance_summaries',
    input: CONNECTION,
    operation: mockOperations.executeSsmListComplianceSummaries,
  },
  {
    toolId: 'ssm_start_automation_execution',
    input: { ...CONNECTION, documentName: 'AWS-RestartEC2Instance' },
    operation: mockOperations.executeSsmStartAutomationExecution,
  },
  {
    toolId: 'ssm_describe_automation_executions',
    input: CONNECTION,
    operation: mockOperations.executeSsmDescribeAutomationExecutions,
  },
  {
    toolId: 'ssm_get_automation_execution',
    input: { ...CONNECTION, automationExecutionId: COMMAND_ID },
    operation: mockOperations.executeSsmGetAutomationExecution,
  },
  {
    toolId: 'ssm_stop_automation_execution',
    input: { ...CONNECTION, automationExecutionId: COMMAND_ID },
    operation: mockOperations.executeSsmStopAutomationExecution,
  },
  {
    toolId: 'ssm_list_documents',
    input: CONNECTION,
    operation: mockOperations.executeSsmListDocuments,
  },
  {
    toolId: 'ssm_get_document',
    input: { ...CONNECTION, name: 'AWS-RunShellScript' },
    operation: mockOperations.executeSsmGetDocument,
  },
] as const

describe('executeSsmTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('validates and dispatches $toolId', async ({ toolId, input, operation }) => {
    const controller = new AbortController()
    operation.mockResolvedValue({ toolId })

    const response = await executeSsmTool(
      createRequest({ toolId, input, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ toolId })
    expect(operation).toHaveBeenCalledWith(input, controller.signal)
  })

  it('returns the route-compatible validation envelope before provider work', async () => {
    const response = await executeSsmTool(createRequest({ input: { region: 'invalid' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mockOperations.executeSsmListCommands).not.toHaveBeenCalled()
  })

  it('rejects a malformed instance ID before calling the provider', async () => {
    const response = await executeSsmTool(
      createRequest({
        toolId: 'ssm_get_command_invocation',
        input: { ...CONNECTION, commandId: COMMAND_ID, instanceId: 'not-an-instance' },
      })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeSsmGetCommandInvocation).not.toHaveBeenCalled()
  })

  it('rejects an unsupported tool id', async () => {
    const response = await executeSsmTool(createRequest({ toolId: 'ssm_not_a_tool' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported Systems Manager tool: ssm_not_a_tool',
    })
  })

  describe('Parameter Store secret handling', () => {
    it('keeps a decrypted parameter value out of the failure envelope', async () => {
      const secret = 'super-secret-database-password'
      mockOperations.executeSsmGetParameter.mockRejectedValue(
        new Error('AccessDeniedException: not authorized to perform ssm:GetParameter')
      )

      const response = await executeSsmTool(
        createRequest({
          toolId: 'ssm_get_parameter',
          input: { ...CONNECTION, name: '/prod/app/db-password', withDecryption: true },
        })
      )

      expect(response.status).toBe(500)
      const body = await response.text()
      expect(body).not.toContain(secret)
      expect(body).not.toContain(CONNECTION.secretAccessKey)
      expect(body).toContain('Failed to get parameter')
    })

    it('keeps the written value out of the put_parameter failure envelope', async () => {
      const secret = 'postgres://user:hunter2@db.example.com/app'
      mockOperations.executeSsmPutParameter.mockRejectedValue(
        new Error('ParameterAlreadyExists: the parameter already exists')
      )

      const response = await executeSsmTool(
        createRequest({
          toolId: 'ssm_put_parameter',
          input: {
            ...CONNECTION,
            name: '/prod/app/database-url',
            value: secret,
            type: 'SecureString',
          },
        })
      )

      expect(response.status).toBe(500)
      const body = await response.text()
      expect(body).not.toContain(secret)
      expect(body).not.toContain('hunter2')
    })

    it('does not decrypt unless the caller opts in', async () => {
      mockOperations.executeSsmGetParameter.mockResolvedValue({ name: '/prod/app/db-password' })

      await executeSsmTool(
        createRequest({
          toolId: 'ssm_get_parameter',
          input: { ...CONNECTION, name: '/prod/app/db-password' },
        })
      )

      const [passedInput] = mockOperations.executeSsmGetParameter.mock.calls[0]
      expect(passedInput.withDecryption).toBeUndefined()
    })
  })
})
