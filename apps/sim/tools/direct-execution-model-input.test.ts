/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { runTaskTool } from '@/tools/browser_use/run_task'
import { managedAgentCreateSessionTool } from '@/tools/managed_agent/create_session'
import { managedAgentRespondCustomToolTool } from '@/tools/managed_agent/respond_custom_tool'
import { managedAgentRespondToolConfirmationTool } from '@/tools/managed_agent/respond_tool_confirmation'
import { managedAgentRunSessionTool } from '@/tools/managed_agent/run_session'
import { managedAgentSendMessageTool } from '@/tools/managed_agent/send_message'
import type { ToolConfig } from '@/tools/types'

function selectModelInput(
  tool: ToolConfig,
  params: Record<string, unknown>
): Record<string, unknown> {
  const modelInput = tool.request.modelInput
  expect(modelInput?.mode).toBe('project')
  if (modelInput?.mode !== 'project') throw new Error(`Expected ${tool.id} to project model input`)
  return modelInput.select(params)
}

describe('direct-execution model-input selectors', () => {
  it('selects only Browser Use fields that are supplied to its agent model', () => {
    expect(
      selectModelInput(runTaskTool, {
        task: 'book a flight',
        systemPromptExtension: 'prefer direct flights',
        structuredOutput: '{"type":"object"}',
        apiKey: 'secret-api-key',
        variables: { password: 'secret-password' },
        profile_id: 'profile-1',
        startUrl: 'https://example.com',
        allowedDomains: 'example.com',
        metadata: { requestId: 'request-1' },
        model: 'browser-use-2.0',
      })
    ).toEqual({
      task: 'book a flight',
      systemPromptExtension: 'prefer direct flights',
      structuredOutput: '{"type":"object"}',
    })
  })

  it('selects only Managed Agent run-session text supplied to the model', () => {
    expect(
      selectModelInput(managedAgentRunSessionTool, {
        userMessage: 'investigate this issue',
        memoryInstructions: 'remember the customer preference',
        accessToken: 'secret-api-key',
        credential: 'credential-1',
        agent: 'agent-1',
        environment: 'environment-1',
        memoryStoreId: 'memory-1',
        sessionParameters: { requestId: 'request-1' },
      })
    ).toEqual({
      userMessage: 'investigate this issue',
      memoryInstructions: 'remember the customer preference',
    })
  })

  it('selects only Managed Agent create-session text supplied to the model', () => {
    expect(
      selectModelInput(managedAgentCreateSessionTool, {
        userMessage: 'start the investigation',
        memoryInstructions: 'use the account history',
        accessToken: 'secret-api-key',
        credential: 'credential-1',
        agent: 'agent-1',
        environment: 'environment-1',
        vaults: ['vault-1'],
        files: [{ fileId: 'file-1' }],
      })
    ).toEqual({
      userMessage: 'start the investigation',
      memoryInstructions: 'use the account history',
    })
  })

  it('selects only the message sent to an existing Managed Agent session', () => {
    expect(
      selectModelInput(managedAgentSendMessageTool, {
        userMessage: 'continue with the next step',
        accessToken: 'secret-api-key',
        credential: 'credential-1',
        sessionId: 'session-1',
      })
    ).toEqual({ userMessage: 'continue with the next step' })
  })

  it('selects only the custom-tool result returned to the Managed Agent', () => {
    expect(
      selectModelInput(managedAgentRespondCustomToolTool, {
        result: 'the operation completed',
        isError: false,
        customToolUseId: 'tool-use-1',
        accessToken: 'secret-api-key',
        credential: 'credential-1',
        sessionId: 'session-1',
      })
    ).toEqual({ result: 'the operation completed' })
  })

  it('selects only the denial reason surfaced to the Managed Agent', () => {
    expect(
      selectModelInput(managedAgentRespondToolConfirmationTool, {
        denyMessage: 'the operation is not authorized',
        decision: 'deny',
        toolUseIds: ['tool-use-1'],
        accessToken: 'secret-api-key',
        credential: 'credential-1',
        sessionId: 'session-1',
      })
    ).toEqual({ denyMessage: 'the operation is not authorized' })

    expect(
      selectModelInput(managedAgentRespondToolConfirmationTool, {
        denyMessage: 'must not be sent',
        decision: 'allow',
        toolUseIds: ['tool-use-1'],
      })
    ).toEqual({})
  })
})
