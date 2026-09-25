import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_RESULT_UNAVAILABLE_ERROR } from '@/lib/mothership/request/tools/resolved-secret-result'

const hoisted = vi.hoisted(() => ({
  routeExecution: vi.fn(),
}))

vi.mock('@/lib/mothership/tools/server/router', () => ({ routeExecution: hoisted.routeExecution }))

import { createServerToolHandler } from '@/lib/mothership/tools/registry/server-tool-adapter'

const mocks = { ...hoisted, loggerError: getMockLogger('ServerToolAdapter').error }

describe('server tool adapter authority boundary', () => {
  beforeEach(() => {
    mocks.routeExecution.mockResolvedValue({ success: true })
  })

  it('publishes the authorized Search address from the direct Assistant tool', async () => {
    mocks.routeExecution.mockResolvedValue({ success: true, data: { query: 'safe policy' } })
    const result = await createServerToolHandler('search_workspace')(
      { query: 'policy', topK: 4 },
      {
        userId: 'reader',
        requestMode: 'assistant',
        organizationId: 'org',
        workflowId: '',
        chatId: 'chat',
        toolCallId: 'call',
        copilotToolExecution: true,
      }
    )
    expect(result.resources).toEqual([
      expect.objectContaining({
        type: 'search',
        id: 'search:organization:org',
        search: expect.objectContaining({ query: 'safe policy', topK: 4 }),
      }),
    ])
  })

  it('overwrites model-supplied workspace scope and forwards trusted delegation context', async () => {
    const handler = createServerToolHandler('prepare_file_edit')

    await handler(
      { workspaceId: 'attacker-workspace', operation: 'rename' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        toolCallId: 'tool-call-1',
        copilotToolExecution: true,
      }
    )

    expect(mocks.routeExecution).toHaveBeenCalledWith(
      'prepare_file_edit',
      expect.objectContaining({ workspaceId: 'workspace-1', operation: 'rename' }),
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        toolCallId: 'tool-call-1',
        copilotToolExecution: true,
      })
    )
  })

  it('logs unexpected failures in full and returns only a generic system message', async () => {
    const storageError = new Error('update workspace_files set secret_column = value')
    mocks.routeExecution.mockRejectedValue(storageError)

    const result = await createServerToolHandler('prepare_file_edit')(
      {},
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        toolCallId: 'tool-call-1',
        copilotToolExecution: true,
      }
    )

    expect(result).toEqual({
      success: false,
      error: `[prepare_file_edit] ${TOOL_RESULT_UNAVAILABLE_ERROR}`,
    })
    expect(result.error).not.toContain('workspace_files')
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Server tool execution failed',
      {
        toolId: 'prepare_file_edit',
        abortSignalAborted: false,
      },
      storageError
    )
  })

  it('forwards trusted Search provenance independently of model parameters', async () => {
    await createServerToolHandler('search_workspace')(
      { query: 'policy', searchSurface: 'copilot', surface: 'copilot' },
      {
        userId: 'user-1',
        workflowId: '',
        organizationId: 'org-1',
        chatId: 'chat-1',
        toolCallId: 'call-1',
        copilotToolExecution: true,
        searchSurface: 'slack',
      }
    )
    expect(mocks.routeExecution).toHaveBeenCalledWith(
      'search_workspace',
      expect.objectContaining({ query: 'policy' }),
      expect.objectContaining({ searchSurface: 'slack', organizationId: 'org-1' })
    )
  })
})

it('forwards canonical open-resource effects without replacing target assertions or injecting a workflow', async () => {
  const resources = [
    { type: 'workflow', id: 'flow', title: 'Canonical', workspaceId: 'workspace-1' },
  ]
  mocks.routeExecution.mockResolvedValue({ resources })
  const params = {
    workspaceId: 'asserted-workspace',
    resources: [{ type: 'workflow', id: 'flow' }],
  }
  const result = await createServerToolHandler('open_resource')(params, {
    userId: 'actor',
    workspaceId: 'workspace-1',
    workflowId: 'unrelated',
    toolCallId: 'call',
    copilotToolExecution: true,
  })
  expect(mocks.routeExecution).toHaveBeenCalledWith(
    'open_resource',
    params,
    expect.objectContaining({ workspaceId: 'workspace-1', userId: 'actor' })
  )
  expect(result).toEqual({ success: true, output: { resources }, resources })
})
