/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { ManagedAgentBlock } from '@/blocks/blocks/managed_agent'

const subBlockById = (id: string) => {
  const config = ManagedAgentBlock.subBlocks.find((sub) => sub.id === id)
  if (!config) throw new Error(`No sub-block '${id}' on the Managed Agent block`)
  return config
}

/** Mirrors how the editor and serializer evaluate visibility: raw stored values. */
const isVisible = (id: string, values: Record<string, unknown>) =>
  evaluateSubBlockCondition(subBlockById(id).condition, values)

const selectTool = (params: Record<string, unknown>) =>
  ManagedAgentBlock.tools.config?.tool?.(params as never)

/**
 * The block gained an operation selector after it shipped. Blocks saved before
 * that have NO stored `operation` value, so these tests pin the promise that
 * they keep behaving — and looking — exactly as they did.
 */
describe('Managed Agent block — legacy blocks without a stored operation', () => {
  const legacyValues = {
    credential: 'cred-1',
    agent: 'agent_1',
    environment: 'env_1',
    environmentType: 'cloud',
    userMessage: 'do the thing',
  }

  it('resolves to the run-session tool', () => {
    expect(selectTool(legacyValues)).toBe('managed_agent_run_session')
  })

  it('resolves to the run-session tool when operation is explicitly absent', () => {
    expect(selectTool({})).toBe('managed_agent_run_session')
    expect(selectTool({ operation: undefined })).toBe('managed_agent_run_session')
    expect(selectTool({ operation: null })).toBe('managed_agent_run_session')
  })

  it.each(['agent', 'environment', 'environmentType', 'userMessage'])(
    'keeps the %s field visible',
    (id) => {
      expect(isVisible(id, legacyValues)).toBe(true)
    }
  )

  it('keeps cloud-only fields visible', () => {
    expect(isVisible('memoryStoreId', legacyValues)).toBe(true)
    expect(isVisible('files', legacyValues)).toBe(true)
    expect(isVisible('sessionParameters', legacyValues)).toBe(true)
  })

  it('still hides cloud-only fields on a self-hosted legacy block', () => {
    const selfHosted = { ...legacyValues, environmentType: 'self_hosted' }
    expect(isVisible('memoryStoreId', selfHosted)).toBe(false)
    expect(isVisible('files', selfHosted)).toBe(false)
    // Metadata applies to both environment models.
    expect(isVisible('sessionParameters', selfHosted)).toBe(true)
  })

  it('does not show session-targeting fields', () => {
    expect(isVisible('sessionId', legacyValues)).toBe(false)
    expect(isVisible('toolUseIds', legacyValues)).toBe(false)
  })

  it('keeps the legacy run-session output shape as the fallback', () => {
    expect(Object.keys(ManagedAgentBlock.outputs)).toEqual(
      expect.arrayContaining(['content', 'sessionId', 'inputTokens', 'outputTokens'])
    )
  })
})

describe('Managed Agent block — operation routing', () => {
  it.each([
    ['run_session', 'managed_agent_run_session'],
    ['create_session', 'managed_agent_create_session'],
    ['send_message', 'managed_agent_send_message'],
    ['get_session', 'managed_agent_get_session'],
    ['list_events', 'managed_agent_list_events'],
    ['update_session', 'managed_agent_update_session'],
    ['interrupt_session', 'managed_agent_interrupt_session'],
    ['respond_tool_confirmation', 'managed_agent_respond_tool_confirmation'],
    ['respond_custom_tool', 'managed_agent_respond_custom_tool'],
    ['archive_session', 'managed_agent_archive_session'],
    ['delete_session', 'managed_agent_delete_session'],
  ])('maps %s to %s', (operation, toolId) => {
    expect(selectTool({ operation })).toBe(toolId)
  })

  it('falls back to run session for an unknown operation', () => {
    expect(selectTool({ operation: 'not_a_real_operation' })).toBe('managed_agent_run_session')
  })

  it('declares every mapped tool in tools.access', () => {
    const operations = subBlockById('operation').options as Array<{ id: string }>
    for (const { id } of operations) {
      expect(ManagedAgentBlock.tools.access).toContain(selectTool({ operation: id }))
    }
  })
})

describe('Managed Agent block — per-operation field visibility', () => {
  it('shows the session id for operations that target an existing session', () => {
    for (const operation of [
      'send_message',
      'get_session',
      'list_events',
      'update_session',
      'interrupt_session',
      'respond_tool_confirmation',
      'respond_custom_tool',
      'archive_session',
      'delete_session',
    ]) {
      expect(isVisible('sessionId', { operation })).toBe(true)
    }
  })

  it('hides the agent and environment pickers once a session exists', () => {
    expect(isVisible('agent', { operation: 'send_message' })).toBe(false)
    expect(isVisible('environment', { operation: 'get_session' })).toBe(false)
    expect(isVisible('environmentType', { operation: 'archive_session' })).toBe(false)
  })

  it('shows the user message for the three operations that send one', () => {
    expect(isVisible('userMessage', { operation: 'run_session' })).toBe(true)
    expect(isVisible('userMessage', { operation: 'create_session' })).toBe(true)
    expect(isVisible('userMessage', { operation: 'send_message' })).toBe(true)
    expect(isVisible('userMessage', { operation: 'get_session' })).toBe(false)
  })

  it('makes the user message optional only for create session', () => {
    const required = subBlockById('userMessage').required
    expect(evaluateSubBlockCondition(required as never, { operation: 'create_session' })).toBe(
      false
    )
    expect(evaluateSubBlockCondition(required as never, { operation: 'send_message' })).toBe(true)
    expect(evaluateSubBlockCondition(required as never, { operation: 'run_session' })).toBe(true)
    // A legacy block has no stored operation and must stay required.
    expect(evaluateSubBlockCondition(required as never, {})).toBe(true)
  })

  it('reveals the deny reason only when denying a tool confirmation', () => {
    expect(
      isVisible('denyMessage', { operation: 'respond_tool_confirmation', decision: 'deny' })
    ).toBe(true)
    expect(
      isVisible('denyMessage', { operation: 'respond_tool_confirmation', decision: 'allow' })
    ).toBe(false)
    expect(isVisible('denyMessage', { operation: 'send_message', decision: 'deny' })).toBe(false)
  })

  it('separates confirmation fields from custom-tool-result fields', () => {
    // A confirmation cannot unblock a custom tool, so the two operations must
    // not share inputs — otherwise a workflow can silently answer the wrong way.
    expect(isVisible('toolUseIds', { operation: 'respond_tool_confirmation' })).toBe(true)
    expect(isVisible('toolUseIds', { operation: 'respond_custom_tool' })).toBe(false)
    expect(isVisible('customToolUseId', { operation: 'respond_custom_tool' })).toBe(true)
    expect(isVisible('customToolUseId', { operation: 'respond_tool_confirmation' })).toBe(false)
    expect(isVisible('result', { operation: 'respond_custom_tool' })).toBe(true)
    expect(isVisible('decision', { operation: 'respond_custom_tool' })).toBe(false)
  })

  it('shows metadata for update session but not the agent config fields', () => {
    expect(isVisible('sessionParameters', { operation: 'update_session' })).toBe(true)
    expect(isVisible('title', { operation: 'update_session' })).toBe(true)
    expect(isVisible('vaults', { operation: 'update_session' })).toBe(false)
  })
})
