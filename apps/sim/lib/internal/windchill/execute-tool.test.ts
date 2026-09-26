import { createExecutionContext } from '@sim/testing'
import {
  executorPrincipalMock,
  executorPrincipalMockFns,
} from '@sim/testing/mocks/executor-principal.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeWindchillOperation: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => executorPrincipalMock)

vi.mock('@/lib/internal/windchill/operations', () => ({
  executeWindchillOperation: mocks.executeWindchillOperation,
}))

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { WindchillProviderError } from '@/lib/internal/windchill/client'
import { executeWindchillTool } from '@/lib/internal/windchill/execute-tool'

const { mockCreateExecutorPrincipalFromExecutionContext } = executorPrincipalMockFns

const BASE = {
  baseUrl: 'https://windchill.example.com/Windchill/servlet/odata/v6',
  username: 'windchill-user',
  password: 'not-a-real-password',
}
const DOCUMENT_OID = 'OR:wt.doc.WTDocument:1'
const PRINCIPAL = {
  kind: 'delegated' as const,
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:windchill',
  issuedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-01-01T01:00:00.000Z'),
  delegationContext: {
    kind: 'workflow_execution' as const,
    workflowId: 'workflow-1',
    executionId: 'execution-1',
  },
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  const defaultBody = { ...BASE, operation: 'windchill_delete_document', documentOid: DOCUMENT_OID }
  return {
    toolId: 'windchill_delete_document',
    input: defaultBody,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeWindchillTool', () => {
  beforeEach(() => {
    mockCreateExecutorPrincipalFromExecutionContext.mockResolvedValue(PRINCIPAL)
  })

  it('rejects a prepared body for a different operation before provider work', async () => {
    const response = await executeWindchillTool(
      createRequest({
        toolId: 'windchill_delete_document',
        input: {
          ...BASE,
          operation: 'windchill_revise_document',
          documentOid: DOCUMENT_OID,
        },
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Windchill request operation does not match the selected tool',
    })
    expect(mocks.executeWindchillOperation).not.toHaveBeenCalled()
  })

  it('preserves provider status and sanitizes sensitive error material', async () => {
    mocks.executeWindchillOperation.mockRejectedValue(
      new WindchillProviderError(
        'Request https://windchill.example.com/file?token=secret with Basic dXNlcjpwYXNz failed',
        409
      )
    )

    const response = await executeWindchillTool(createRequest())

    expect(response.status).toBe(409)
    const result = await response.json()
    expect(result.success).toBe(false)
    expect(result.error).not.toContain('token=secret')
    expect(result.error).not.toContain('dXNlcjpwYXNz')
  })
})
