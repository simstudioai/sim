/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => {
  const createMockLogger = (): Record<string, any> => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    withMetadata: vi.fn(() => createMockLogger()),
  })
  return { createLogger: vi.fn(() => createMockLogger()) }
})

vi.mock('@/lib/billing/core/subscription', () => ({
  getUserSubscriptionState: vi.fn(),
}))

vi.mock('@/lib/copilot/chat-context', () => ({
  processFileAttachments: vi.fn(),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isHosted: false,
}))

vi.mock('@/lib/mcp/utils', () => ({
  createMcpToolId: vi.fn(),
}))

vi.mock('@/lib/workflows/utils', () => ({
  getWorkflowById: vi.fn(),
}))

vi.mock('@/tools/registry', () => ({
  tools: {
    gmail_send: {
      id: 'gmail_send',
      name: 'Gmail Send',
      description: 'Send emails using Gmail',
    },
    brandfetch_search: {
      id: 'brandfetch_search',
      name: 'Brandfetch Search',
      description: 'Search for brands by company name',
    },
  },
}))

vi.mock('@/tools/utils', () => ({
  getLatestVersionTools: vi.fn((input) => input),
  stripVersionSuffix: vi.fn((toolId: string) => toolId),
}))

vi.mock('@/tools/params', () => ({
  createUserToolSchema: vi.fn(() => ({ type: 'object', properties: {} })),
}))

import { getUserSubscriptionState } from '@/lib/billing/core/subscription'
import { buildIntegrationToolSchemas } from '@/lib/copilot/chat-payload'

const mockedGetUserSubscriptionState = getUserSubscriptionState as unknown as {
  mockResolvedValue: (value: unknown) => void
  mockRejectedValue: (value: unknown) => void
  mockClear: () => void
}

describe('buildIntegrationToolSchemas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appends the email footer prompt for free users', async () => {
    mockedGetUserSubscriptionState.mockResolvedValue({ isFree: true })

    const toolSchemas = await buildIntegrationToolSchemas('user-free')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')

    expect(getUserSubscriptionState).toHaveBeenCalledWith('user-free')
    expect(gmailTool?.description).toContain('sent with sim ai')
  })

  it('does not append the email footer prompt for paid users', async () => {
    mockedGetUserSubscriptionState.mockResolvedValue({ isFree: false })

    const toolSchemas = await buildIntegrationToolSchemas('user-paid')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')

    expect(getUserSubscriptionState).toHaveBeenCalledWith('user-paid')
    expect(gmailTool?.description).toBe('Send emails using Gmail')
  })

  it('still builds integration tools when subscription lookup fails', async () => {
    mockedGetUserSubscriptionState.mockRejectedValue(new Error('db unavailable'))

    const toolSchemas = await buildIntegrationToolSchemas('user-error')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')
    const brandfetchTool = toolSchemas.find((tool) => tool.name === 'brandfetch_search')

    expect(getUserSubscriptionState).toHaveBeenCalledWith('user-error')
    expect(gmailTool?.description).toBe('Send emails using Gmail')
    expect(brandfetchTool?.description).toBe('Search for brands by company name')
  })
})
