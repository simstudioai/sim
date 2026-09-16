/**
 * @vitest-environment node
 */
import { isValidUuid } from '@sim/utils/id'
import { describe, expect, it } from 'vitest'
import { resolveMothershipConversation } from '@/lib/mothership/conversation-id'

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111'
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222'

describe('resolveMothershipConversation', () => {
  it('mints a fresh token when no conversation id is given', () => {
    const first = resolveMothershipConversation(WORKSPACE_A, undefined)
    const second = resolveMothershipConversation(WORKSPACE_A, '   ')
    expect(isValidUuid(first.conversationId)).toBe(true)
    expect(isValidUuid(first.chatId)).toBe(true)
    expect(first.chatId).not.toBe(first.conversationId)
    expect(first.chatId).not.toBe(second.chatId)
  })

  it('derives a stable chat id scoped to the workspace and exposes the given id', () => {
    const resolved = resolveMothershipConversation(WORKSPACE_A, ' customer-456 ')
    expect(resolved.conversationId).toBe('customer-456')
    expect(isValidUuid(resolved.chatId)).toBe(true)
    expect(resolveMothershipConversation(WORKSPACE_A, 'customer-456').chatId).toBe(resolved.chatId)
    expect(resolveMothershipConversation(WORKSPACE_A, 'customer-457').chatId).not.toBe(
      resolved.chatId
    )
    expect(resolveMothershipConversation(WORKSPACE_B, 'customer-456').chatId).not.toBe(
      resolved.chatId
    )
  })

  it('derives UUID-shaped ids too, so a block can never reach a chat it did not derive', () => {
    const pasted = '3b2f0d4e-8a6c-4f1b-9e2d-5c7a1b3d9f00'
    const resolved = resolveMothershipConversation(WORKSPACE_A, pasted)
    expect(resolved.conversationId).toBe(pasted)
    expect(resolved.chatId).not.toBe(pasted)
    expect(isValidUuid(resolved.chatId)).toBe(true)
  })

  it('continues the same thread when the exposed id is chained into another block', () => {
    const first = resolveMothershipConversation(WORKSPACE_A, undefined)
    const chained = resolveMothershipConversation(WORKSPACE_A, first.conversationId)
    expect(chained.chatId).toBe(first.chatId)
  })

  it('never forwards the literal string', () => {
    const secretish = 'chat-plaintext-secret-__var_API_KEY-__sim_secret_API_KEY'
    const { chatId } = resolveMothershipConversation(WORKSPACE_A, secretish)
    expect(chatId).not.toContain('secret')
    expect(chatId).not.toContain('__')
  })

  it('refuses to resolve without a workspace', () => {
    expect(() => resolveMothershipConversation('', 'customer-456')).toThrow(
      'Workspace context is required'
    )
  })
})
