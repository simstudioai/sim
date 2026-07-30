/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBlock } = vi.hoisted(() => ({ mockGetBlock: vi.fn() }))

vi.mock('@/blocks', () => ({ getBlock: mockGetBlock }))

import { redactBlocks, redactSingleBlock } from '@/lib/workflows/api-reference/redact'

/**
 * A block config whose subBlocks span safe selector types AND unsafe secret-bearing
 * types, so the allowlist can be proven to keep only the former.
 */
const BLOCK_CONFIG = {
  subBlocks: [
    { id: 'operation', type: 'dropdown' },
    { id: 'enabled', type: 'switch' },
    { id: 'apiKey', type: 'short-input' },
    { id: 'credential', type: 'oauth-input' },
    { id: 'systemPrompt', type: 'long-input' },
    { id: 'messages', type: 'messages-input' },
    { id: 'code', type: 'code' },
    { id: 'headers', type: 'table' },
  ],
}

const DEPLOYED_BLOCKS = {
  'block-a': {
    type: 'agent',
    name: 'Fetch Profile',
    subBlocks: {
      operation: { value: 'search' },
      enabled: { value: true },
      apiKey: { value: 'sk-super-secret-key' },
      credential: { value: 'oauth-token-abc' },
      systemPrompt: { value: 'You are a helpful assistant. Internal policy: ...' },
      messages: { value: [{ role: 'system', content: 'secret prompt' }] },
      code: { value: 'const password = "hunter2"' },
      headers: { value: [['Authorization', 'Bearer secret']] },
    },
  },
  'block-b': { type: 'agent', name: 'Summarize', subBlocks: {} },
}

const EDGES = [{ source: 'block-a', target: 'block-b' }]

describe('block redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBlock.mockReturnValue(BLOCK_CONFIG)
  })

  it('exposes only allowlisted selector fields and never secrets', () => {
    const [blockA] = redactBlocks(DEPLOYED_BLOCKS, EDGES)
    expect(blockA.id).toBe('block-a')
    expect(blockA.name).toBe('Fetch Profile')
    // Allowlisted selectors survive.
    expect(blockA.config).toEqual({ operation: 'search', enabled: true })
  })

  it('drops every secret-bearing field type', () => {
    const [blockA] = redactBlocks(DEPLOYED_BLOCKS, EDGES)
    const serialized = JSON.stringify(blockA)
    for (const secret of [
      'sk-super-secret-key',
      'oauth-token-abc',
      'helpful assistant',
      'secret prompt',
      'hunter2',
      'Bearer secret',
    ]) {
      expect(serialized).not.toContain(secret)
    }
    for (const key of ['apiKey', 'credential', 'systemPrompt', 'messages', 'code', 'headers']) {
      expect(blockA.config[key]).toBeUndefined()
    }
  })

  it('exposes structural wiring from the edges', () => {
    const [blockA] = redactBlocks(DEPLOYED_BLOCKS, EDGES)
    expect(blockA.outgoing).toEqual(['block-b'])
  })

  it('fails closed (no config) for an unknown/custom block type', () => {
    mockGetBlock.mockReturnValue(undefined)
    const [blockA] = redactBlocks(DEPLOYED_BLOCKS, EDGES)
    expect(blockA.config).toEqual({})
  })

  it('redactSingleBlock returns null for an unknown block id', () => {
    expect(redactSingleBlock(DEPLOYED_BLOCKS, EDGES, 'does-not-exist')).toBeNull()
  })
})
