import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { ExecutionState } from '@/executor/execution/state'
import { BlockResolver } from './block'
import type { ResolutionContext } from './reference'

vi.mock('@sim/logger', () => loggerMock)

/**
 * Creates a minimal workflow for testing.
 */
function createTestWorkflow(blocks: Array<{ id: string; name?: string; type?: string }> = []) {
  return {
    version: '1.0',
    blocks: blocks.map((b) => ({
      id: b.id,
      position: { x: 0, y: 0 },
      config: { tool: b.type ?? 'function', params: {} },
      inputs: {},
      outputs: {},
      metadata: { id: b.type ?? 'function', name: b.name ?? b.id },
      enabled: true,
    })),
    connections: [],
    loops: {},
    parallels: {},
  }
}

/**
 * Creates a test ResolutionContext with block outputs.
 */
function createTestContext(
  currentNodeId: string,
  blockOutputs: Record<string, any> = {},
  contextBlockStates?: Map<string, { output: any }>
): ResolutionContext {
  const state = new ExecutionState()
  for (const [blockId, output] of Object.entries(blockOutputs)) {
    state.setBlockOutput(blockId, output)
  }

  return {
    executionContext: {
      blockStates: contextBlockStates ?? new Map(),
    },
    executionState: state,
    currentNodeId,
  } as unknown as ResolutionContext
}

describe('BlockResolver', () => {
  describe('canResolve', () => {
    it.concurrent('should return true for block references', () => {
      const resolver = new BlockResolver(createTestWorkflow([{ id: 'block-1' }]))
      expect(resolver.canResolve('<block-1>')).toBe(true)
      expect(resolver.canResolve('<block-1.output>')).toBe(true)
      expect(resolver.canResolve('<block-1.result.value>')).toBe(true)
    })

    it.concurrent('should return true for block references by name', () => {
      const resolver = new BlockResolver(createTestWorkflow([{ id: 'block-1', name: 'My Block' }]))
      expect(resolver.canResolve('<myblock>')).toBe(true)
      expect(resolver.canResolve('<My Block>')).toBe(true)
    })

    it.concurrent('should return false for special prefixes', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.canResolve('<loop.index>')).toBe(false)
      expect(resolver.canResolve('<parallel.currentItem>')).toBe(false)
      expect(resolver.canResolve('<variable.myvar>')).toBe(false)
    })

    it.concurrent('should return false for non-references', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.canResolve('plain text')).toBe(false)
      expect(resolver.canResolve('{{ENV_VAR}}')).toBe(false)
      expect(resolver.canResolve('block-1.output')).toBe(false)
    })
  })

  describe('resolve', () => {
    it.concurrent('should resolve block output by ID', () => {
      const workflow = createTestWorkflow([{ id: 'source-block' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'source-block': { result: 'success', data: { value: 42 } },
      })

      expect(resolver.resolve('<source-block>', ctx)).toEqual({
        result: 'success',
        data: { value: 42 },
      })
    })

    it.concurrent('should resolve block output by name', () => {
      const workflow = createTestWorkflow([{ id: 'block-123', name: 'My Source Block' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'block-123': { message: 'hello' },
      })

      expect(resolver.resolve('<mysourceblock>', ctx)).toEqual({ message: 'hello' })
      expect(resolver.resolve('<My Source Block>', ctx)).toEqual({ message: 'hello' })
    })

    it.concurrent('should resolve nested property path', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { user: { profile: { name: 'Alice', email: 'alice@test.com' } } },
      })

      expect(resolver.resolve('<source.user.profile.name>', ctx)).toBe('Alice')
      expect(resolver.resolve('<source.user.profile.email>', ctx)).toBe('alice@test.com')
    })

    it.concurrent('should resolve array index in path', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      })

      expect(resolver.resolve('<source.items.0>', ctx)).toEqual({ id: 1 })
      expect(resolver.resolve('<source.items.1.id>', ctx)).toBe(2)
    })

    it.concurrent('should throw error for non-existent path', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { existing: 'value' },
      })

      expect(() => resolver.resolve('<source.nonexistent>', ctx)).toThrow(
        /No value found at path "nonexistent" in block "source"/
      )
    })

    it.concurrent('should return undefined for non-existent block', () => {
      const workflow = createTestWorkflow([{ id: 'existing' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {})

      expect(resolver.resolve('<nonexistent>', ctx)).toBeUndefined()
    })

    it.concurrent('should fall back to context blockStates', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const contextStates = new Map([['source', { output: { fallback: true } }]])
      const ctx = createTestContext('current', {}, contextStates)

      expect(resolver.resolve('<source>', ctx)).toEqual({ fallback: true })
    })
  })

  describe('formatValueForBlock', () => {
    it.concurrent('should format string for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      const result = resolver.formatValueForBlock('hello world', 'condition')
      expect(result).toBe('"hello world"')
    })

    it.concurrent('should escape special characters for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock('line1\nline2', 'condition')).toBe('"line1\\nline2"')
      expect(resolver.formatValueForBlock('quote "test"', 'condition')).toBe('"quote \\"test\\""')
      expect(resolver.formatValueForBlock('backslash \\', 'condition')).toBe('"backslash \\\\"')
      expect(resolver.formatValueForBlock('tab\there', 'condition')).toBe('"tab\there"')
    })

    it.concurrent('should format object for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      const result = resolver.formatValueForBlock({ key: 'value' }, 'condition')
      expect(result).toBe('{"key":"value"}')
    })

    it.concurrent('should format null/undefined for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock(null, 'condition')).toBe('null')
      expect(resolver.formatValueForBlock(undefined, 'condition')).toBe('undefined')
    })

    it.concurrent('should format number for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock(42, 'condition')).toBe('42')
      expect(resolver.formatValueForBlock(3.14, 'condition')).toBe('3.14')
      expect(resolver.formatValueForBlock(-100, 'condition')).toBe('-100')
    })

    it.concurrent('should format boolean for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock(true, 'condition')).toBe('true')
      expect(resolver.formatValueForBlock(false, 'condition')).toBe('false')
    })

    it.concurrent('should format string for function block (JSON escaped)', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      const result = resolver.formatValueForBlock('hello', 'function')
      expect(result).toBe('"hello"')
    })

    it.concurrent('should format string for function block in template literal', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      const result = resolver.formatValueForBlock('hello', 'function', true)
      expect(result).toBe('hello')
    })

    it.concurrent('should format object for function block in template literal', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      const result = resolver.formatValueForBlock({ a: 1 }, 'function', true)
      expect(result).toBe('{"a":1}')
    })

    it.concurrent('should format null/undefined for function block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock(null, 'function')).toBe('null')
      expect(resolver.formatValueForBlock(undefined, 'function')).toBe('undefined')
    })

    it.concurrent('should format string for response block (no quotes)', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock('plain text', 'response')).toBe('plain text')
    })

    it.concurrent('should format object for response block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock({ key: 'value' }, 'response')).toBe('{"key":"value"}')
    })

    it.concurrent('should format array for response block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock([1, 2, 3], 'response')).toBe('[1,2,3]')
    })

    it.concurrent('should format primitives for response block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock(42, 'response')).toBe('42')
      expect(resolver.formatValueForBlock(true, 'response')).toBe('true')
    })

    it.concurrent('should format object for default block type', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock({ x: 1 }, undefined)).toBe('{"x":1}')
      expect(resolver.formatValueForBlock({ x: 1 }, 'agent')).toBe('{"x":1}')
    })

    it.concurrent('should format primitive for default block type', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock('text', undefined)).toBe('text')
      expect(resolver.formatValueForBlock(123, undefined)).toBe('123')
    })
  })

  describe('tryParseJSON', () => {
    it.concurrent('should parse valid JSON object string', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.tryParseJSON('{"key": "value"}')).toEqual({ key: 'value' })
    })

    it.concurrent('should parse valid JSON array string', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.tryParseJSON('[1, 2, 3]')).toEqual([1, 2, 3])
    })

    it.concurrent('should return original value for non-string input', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      const obj = { key: 'value' }
      expect(resolver.tryParseJSON(obj)).toBe(obj)
      expect(resolver.tryParseJSON(123)).toBe(123)
      expect(resolver.tryParseJSON(null)).toBe(null)
    })

    it.concurrent('should return original string for non-JSON strings', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.tryParseJSON('plain text')).toBe('plain text')
      expect(resolver.tryParseJSON('123')).toBe('123')
      expect(resolver.tryParseJSON('')).toBe('')
    })

    it.concurrent('should return original string for invalid JSON', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.tryParseJSON('{invalid json}')).toBe('{invalid json}')
      expect(resolver.tryParseJSON('[1, 2,')).toBe('[1, 2,')
    })

    it.concurrent('should handle whitespace around JSON', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.tryParseJSON('  {"key": "value"}  ')).toEqual({ key: 'value' })
      expect(resolver.tryParseJSON('\n[1, 2]\n')).toEqual([1, 2])
    })
  })

  describe('edge cases', () => {
    it.concurrent('should handle case-insensitive block name matching', () => {
      const workflow = createTestWorkflow([{ id: 'block-1', name: 'My Block' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', { 'block-1': { data: 'test' } })

      expect(resolver.resolve('<MYBLOCK>', ctx)).toEqual({ data: 'test' })
      expect(resolver.resolve('<myblock>', ctx)).toEqual({ data: 'test' })
      expect(resolver.resolve('<MyBlock>', ctx)).toEqual({ data: 'test' })
    })

    it.concurrent('should handle block names with spaces', () => {
      const workflow = createTestWorkflow([{ id: 'block-1', name: 'API Request Block' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', { 'block-1': { status: 200 } })

      expect(resolver.resolve('<apirequestblock>', ctx)).toEqual({ status: 200 })
    })

    it.concurrent('should handle empty path returning entire output', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const output = { a: 1, b: 2, c: { nested: true } }
      const ctx = createTestContext('current', { source: output })

      expect(resolver.resolve('<source>', ctx)).toEqual(output)
    })

    it.concurrent('should handle output with null values', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { value: null, other: 'exists' },
      })

      expect(resolver.resolve('<source.value>', ctx)).toBeNull()
      expect(resolver.resolve('<source.other>', ctx)).toBe('exists')
    })

    it.concurrent('should handle output with undefined values', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { value: undefined, other: 'exists' },
      })

      expect(() => resolver.resolve('<source.value>', ctx)).toThrow()
    })

    it.concurrent('should handle deeply nested path errors', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { level1: { level2: {} } },
      })

      expect(() => resolver.resolve('<source.level1.level2.level3>', ctx)).toThrow(
        /No value found at path "level1.level2.level3"/
      )
    })
  })
})
