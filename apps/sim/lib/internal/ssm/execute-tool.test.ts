import { describe, expect, it, vi } from 'vitest'

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

describe('executeSsmTool', () => {
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
  })
})
