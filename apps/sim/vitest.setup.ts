import { afterAll, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

// Minimal env required by many API route tests
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/sim_test'
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

// Lightweight mocks for heavy modules to keep route tests fast
vi.mock('@sim/db', () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
  }
  return {
    db: chain,
    schema: {},
  }
})

// Keep auth mock lightweight so per-test vi.doMock overrides work
vi.mock('@/lib/auth', () => {
  const getSession = vi.fn().mockResolvedValue(null) // default unauthenticated
  const signIn = vi.fn()
  const signUp = vi.fn()
  const auth = {
    api: {
      registerSSOProvider: vi.fn(),
      signInEmail: vi.fn(),
      signUpEmail: vi.fn(),
    },
  }
  return { getSession, auth, signIn, signUp }
})

vi.mock('@/lib/workflows/streaming', () => {
  return {
    createStreamingResponse: vi.fn(async () => new Response('error', { status: 500 })),
  }
})

vi.mock('binary-extensions', () => ({ default: ['.bin', '.exe'] }))

vi.mock('@react-email/render', () => ({
  render: vi.fn(() => '<html><body>test email</body></html>'),
}))

global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  })
) as any

// Mock localStorage and sessionStorage for Zustand persist middleware
const storageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(),
  length: 0,
}

global.localStorage = storageMock as any
global.sessionStorage = storageMock as any

// Mock drizzle-orm sql template literal globally for tests
vi.mock('drizzle-orm', () => ({
  sql: vi.fn((strings, ...values) => ({
    strings,
    values,
    type: 'sql',
    _: { brand: 'SQL' },
  })),
  eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
  and: vi.fn((...conditions) => ({ type: 'and', conditions })),
  desc: vi.fn((field) => ({ field, type: 'desc' })),
  or: vi.fn((...conditions) => ({ type: 'or', conditions })),
  InferSelectModel: {},
  InferInsertModel: {},
}))

vi.mock('@/lib/logs/console/logger', () => {
  const createLogger = vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }))

  return { createLogger }
})

vi.mock('@/stores/console/store', () => ({
  useConsoleStore: {
    getState: vi.fn().mockReturnValue({
      addConsole: vi.fn(),
    }),
  },
}))

vi.mock('@/stores/terminal', () => ({
  useTerminalConsoleStore: {
    getState: vi.fn().mockReturnValue({
      addConsole: vi.fn(),
      updateConsole: vi.fn(),
    }),
  },
}))

vi.mock('@/stores/execution/store', () => ({
  useExecutionStore: {
    getState: vi.fn().mockReturnValue({
      setIsExecuting: vi.fn(),
      setIsDebugging: vi.fn(),
      setPendingBlocks: vi.fn(),
      reset: vi.fn(),
      setActiveBlocks: vi.fn(),
    }),
  },
}))

vi.mock('@/blocks/registry', () => ({
  getBlock: vi.fn(() => ({
    name: 'Mock Block',
    description: 'Mock block description',
    icon: () => null,
    subBlocks: [],
    outputs: {},
  })),
  getAllBlocks: vi.fn(() => ({})),
}))

const originalConsoleError = console.error
const originalConsoleWarn = console.warn

console.error = (...args: any[]) => {
  if (args[0] === 'Workflow execution failed:' && args[1]?.message === 'Test error') {
    return
  }
  if (typeof args[0] === 'string' && args[0].includes('[zustand persist middleware]')) {
    return
  }
  originalConsoleError(...args)
}

console.warn = (...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].includes('[zustand persist middleware]')) {
    return
  }
  originalConsoleWarn(...args)
}

afterAll(() => {
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
})
