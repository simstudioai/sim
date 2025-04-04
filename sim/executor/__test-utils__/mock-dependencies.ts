import { vi } from 'vitest'

// Mock common dependencies used across executor handler tests

// Logger
vi.mock('@/lib/logs/console-logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

// Tools
vi.mock('@/tools')

// Providers
vi.mock('@/providers', () => ({
  executeProviderRequest: vi.fn(),
  // Add other exports from '@/providers' if they are used and need mocking
}))
vi.mock('@/providers/utils', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    // @ts-ignore
    ...actual,
    getProviderFromModel: vi.fn(),
    transformBlockTool: vi.fn(),
    // Ensure getBaseModelProviders returns an object
    getBaseModelProviders: vi.fn(() => ({})),
  }
})

// Executor utilities
vi.mock('../../path')
vi.mock('../../resolver', () => ({
  InputResolver: vi.fn(), // Simple mock constructor
}))

// Specific block utilities (like router prompt generator)
vi.mock('@/blocks/blocks/router')

// Mock blocks - needed by agent handler for transformBlockTool
vi.mock('@/blocks')
