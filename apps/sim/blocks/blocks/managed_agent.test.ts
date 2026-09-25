import { describe, expect, it } from 'vitest'
import { ManagedAgentBlock } from '@/blocks/blocks/managed_agent'

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
})
