/**
 * Tests for workflow normalization utilities
 */
import { describe, expect, it } from 'vitest'
import type { Loop, Parallel } from '@/stores/workflows/workflow/types'
import {
  normalizedStringify,
  normalizeEdge,
  normalizeLoop,
  normalizeParallel,
  normalizeValue,
  sanitizeInputFormat,
  sanitizeTools,
  sortEdges,
} from './normalize'

describe('Workflow Normalization Utilities', () => {
  describe('normalizeValue', () => {
    it.concurrent('should return primitives unchanged', () => {
      expect(normalizeValue(42)).toBe(42)
      expect(normalizeValue('hello')).toBe('hello')
      expect(normalizeValue(true)).toBe(true)
      expect(normalizeValue(false)).toBe(false)
    })

    it.concurrent('should normalize null and undefined to undefined', () => {
      // null and undefined are semantically equivalent in our system
      expect(normalizeValue(null)).toBe(undefined)
      expect(normalizeValue(undefined)).toBe(undefined)
    })

    it.concurrent('should handle arrays by normalizing each element', () => {
      const input = [
        { b: 2, a: 1 },
        { d: 4, c: 3 },
      ]
      const result = normalizeValue(input)

      expect(result).toEqual([
        { a: 1, b: 2 },
        { c: 3, d: 4 },
      ])
    })

    it.concurrent('should sort object keys alphabetically', () => {
      const input = { zebra: 1, apple: 2, mango: 3 }
      const result = normalizeValue(input) as Record<string, unknown>

      expect(Object.keys(result)).toEqual(['apple', 'mango', 'zebra'])
    })

    it.concurrent('should recursively normalize nested objects', () => {
      const input = {
        outer: {
          z: 1,
          a: {
            y: 2,
            b: 3,
          },
        },
        first: 'value',
      }
      const result = normalizeValue(input) as {
        first: string
        outer: { z: number; a: { y: number; b: number } }
      }

      expect(Object.keys(result)).toEqual(['first', 'outer'])
      expect(Object.keys(result.outer)).toEqual(['a', 'z'])
      expect(Object.keys(result.outer.a)).toEqual(['b', 'y'])
    })

    it.concurrent('should handle empty objects', () => {
      expect(normalizeValue({})).toEqual({})
    })

    it.concurrent('should handle empty arrays', () => {
      expect(normalizeValue([])).toEqual([])
    })

    it.concurrent('should handle arrays with mixed types', () => {
      const input = [1, 'string', { b: 2, a: 1 }, null, [3, 2, 1]]
      const result = normalizeValue(input) as unknown[]

      expect(result[0]).toBe(1)
      expect(result[1]).toBe('string')
      expect(Object.keys(result[2] as Record<string, unknown>)).toEqual(['a', 'b'])
      expect(result[3]).toBe(undefined) // null normalized to undefined
      expect(result[4]).toEqual([3, 2, 1]) // Array order preserved
    })

    it.concurrent('should handle deeply nested structures', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              level4: {
                z: 'deep',
                a: 'value',
              },
            },
          },
        },
      }
      const result = normalizeValue(input) as {
        level1: { level2: { level3: { level4: { z: string; a: string } } } }
      }

      expect(Object.keys(result.level1.level2.level3.level4)).toEqual(['a', 'z'])
    })
  })

  describe('normalizedStringify', () => {
    it.concurrent('should produce identical strings for objects with different key orders', () => {
      const obj1 = { b: 2, a: 1, c: 3 }
      const obj2 = { a: 1, c: 3, b: 2 }
      const obj3 = { c: 3, b: 2, a: 1 }

      const str1 = normalizedStringify(obj1)
      const str2 = normalizedStringify(obj2)
      const str3 = normalizedStringify(obj3)

      expect(str1).toBe(str2)
      expect(str2).toBe(str3)
    })

    it.concurrent('should produce valid JSON', () => {
      const obj = { nested: { value: [1, 2, 3] }, name: 'test' }
      const str = normalizedStringify(obj)

      expect(() => JSON.parse(str)).not.toThrow()
    })

    it.concurrent('should handle primitive values', () => {
      expect(normalizedStringify(42)).toBe('42')
      expect(normalizedStringify('hello')).toBe('"hello"')
      expect(normalizedStringify(true)).toBe('true')
    })

    it.concurrent('should treat null and undefined equivalently', () => {
      // Both null and undefined normalize to undefined, which JSON.stringify returns as undefined
      expect(normalizedStringify(null)).toBe(normalizedStringify(undefined))
    })

    it.concurrent('should produce different strings for different values', () => {
      const obj1 = { a: 1, b: 2 }
      const obj2 = { a: 1, b: 3 }

      expect(normalizedStringify(obj1)).not.toBe(normalizedStringify(obj2))
    })
  })

  describe('normalizeLoop', () => {
    it.concurrent('should normalize null/undefined to undefined', () => {
      // null and undefined are semantically equivalent
      expect(normalizeLoop(null)).toBe(undefined)
      expect(normalizeLoop(undefined)).toBe(undefined)
    })

    it.concurrent('should normalize "for" loop type', () => {
      const loop: Loop & { extraField?: string } = {
        id: 'loop1',
        nodes: ['block1', 'block2'],
        loopType: 'for',
        iterations: 10,
        forEachItems: 'should-be-excluded',
        whileCondition: 'should-be-excluded',
        doWhileCondition: 'should-be-excluded',
        extraField: 'should-be-excluded',
      }
      const result = normalizeLoop(loop)

      expect(result).toEqual({
        id: 'loop1',
        nodes: ['block1', 'block2'],
        loopType: 'for',
        iterations: 10,
      })
    })

    it.concurrent('should normalize "forEach" loop type', () => {
      const loop: Loop = {
        id: 'loop2',
        nodes: ['block1'],
        loopType: 'forEach',
        iterations: 5,
        forEachItems: '<block.items>',
        whileCondition: 'should-be-excluded',
      }
      const result = normalizeLoop(loop)

      expect(result).toEqual({
        id: 'loop2',
        nodes: ['block1'],
        loopType: 'forEach',
        forEachItems: '<block.items>',
      })
    })

    it.concurrent('should normalize "while" loop type', () => {
      const loop: Loop = {
        id: 'loop3',
        nodes: ['block1', 'block2', 'block3'],
        loopType: 'while',
        iterations: 0,
        whileCondition: '<block.condition> === true',
        doWhileCondition: 'should-be-excluded',
      }
      const result = normalizeLoop(loop)

      expect(result).toEqual({
        id: 'loop3',
        nodes: ['block1', 'block2', 'block3'],
        loopType: 'while',
        whileCondition: '<block.condition> === true',
      })
    })

    it.concurrent('should normalize "doWhile" loop type', () => {
      const loop: Loop = {
        id: 'loop4',
        nodes: ['block1'],
        loopType: 'doWhile',
        iterations: 0,
        doWhileCondition: '<counter.value> < 100',
        whileCondition: 'should-be-excluded',
      }
      const result = normalizeLoop(loop)

      expect(result).toEqual({
        id: 'loop4',
        nodes: ['block1'],
        loopType: 'doWhile',
        doWhileCondition: '<counter.value> < 100',
      })
    })

    it.concurrent('should extract only relevant fields for for loop type', () => {
      const loop: Loop = {
        id: 'loop5',
        nodes: ['block1'],
        loopType: 'for',
        iterations: 5,
        forEachItems: 'items',
      }
      const result = normalizeLoop(loop)

      expect(result).toEqual({
        id: 'loop5',
        nodes: ['block1'],
        loopType: 'for',
        iterations: 5,
      })
    })
  })

  describe('normalizeParallel', () => {
    it.concurrent('should normalize null/undefined to undefined', () => {
      // null and undefined are semantically equivalent
      expect(normalizeParallel(null)).toBe(undefined)
      expect(normalizeParallel(undefined)).toBe(undefined)
    })

    it.concurrent('should normalize "count" parallel type', () => {
      const parallel: Parallel & { extraField?: string } = {
        id: 'parallel1',
        nodes: ['block1', 'block2'],
        parallelType: 'count',
        count: 5,
        distribution: 'should-be-excluded',
        extraField: 'should-be-excluded',
      }
      const result = normalizeParallel(parallel)

      expect(result).toEqual({
        id: 'parallel1',
        nodes: ['block1', 'block2'],
        parallelType: 'count',
        count: 5,
      })
    })

    it.concurrent('should normalize "collection" parallel type', () => {
      const parallel: Parallel = {
        id: 'parallel2',
        nodes: ['block1'],
        parallelType: 'collection',
        count: 10,
        distribution: '<block.items>',
      }
      const result = normalizeParallel(parallel)

      expect(result).toEqual({
        id: 'parallel2',
        nodes: ['block1'],
        parallelType: 'collection',
        distribution: '<block.items>',
      })
    })

    it.concurrent('should include base fields for undefined parallel type', () => {
      const parallel: Parallel = {
        id: 'parallel3',
        nodes: ['block1'],
        parallelType: undefined,
        count: 5,
        distribution: 'items',
      }
      const result = normalizeParallel(parallel)

      expect(result).toEqual({
        id: 'parallel3',
        nodes: ['block1'],
        parallelType: undefined,
      })
    })
  })

  describe('sanitizeTools', () => {
    it.concurrent('should return empty array for undefined', () => {
      expect(sanitizeTools(undefined)).toEqual([])
    })

    it.concurrent('should return empty array for non-array input', () => {
      expect(sanitizeTools(null as any)).toEqual([])
      expect(sanitizeTools('not-an-array' as any)).toEqual([])
      expect(sanitizeTools({} as any)).toEqual([])
    })

    it.concurrent('should remove isExpanded field from tools', () => {
      const tools = [
        { id: 'tool1', name: 'Search', isExpanded: true },
        { id: 'tool2', name: 'Calculator', isExpanded: false },
        { id: 'tool3', name: 'Weather' },
      ]
      const result = sanitizeTools(tools)

      expect(result).toEqual([
        { id: 'tool1', name: 'Search' },
        { id: 'tool2', name: 'Calculator' },
        { id: 'tool3', name: 'Weather' },
      ])
    })

    it.concurrent('should preserve all other fields', () => {
      const tools = [
        {
          id: 'tool1',
          name: 'Complex Tool',
          isExpanded: true,
          schema: { type: 'function', name: 'search' },
          params: { query: 'test' },
          nested: { deep: { value: 123 } },
        },
      ]
      const result = sanitizeTools(tools)

      expect(result[0]).toEqual({
        id: 'tool1',
        name: 'Complex Tool',
        schema: { type: 'function', name: 'search' },
        params: { query: 'test' },
        nested: { deep: { value: 123 } },
      })
    })

    it.concurrent('should handle empty array', () => {
      expect(sanitizeTools([])).toEqual([])
    })
  })

  describe('sanitizeInputFormat', () => {
    it.concurrent('should return empty array for undefined', () => {
      expect(sanitizeInputFormat(undefined)).toEqual([])
    })

    it.concurrent('should return empty array for non-array input', () => {
      expect(sanitizeInputFormat(null as any)).toEqual([])
      expect(sanitizeInputFormat('not-an-array' as any)).toEqual([])
      expect(sanitizeInputFormat({} as any)).toEqual([])
    })

    it.concurrent('should remove collapsed field but keep value', () => {
      const inputFormat = [
        { id: 'input1', name: 'Name', value: 'John', collapsed: true },
        { id: 'input2', name: 'Age', value: 25, collapsed: false },
        { id: 'input3', name: 'Email' },
      ]
      const result = sanitizeInputFormat(inputFormat)

      expect(result).toEqual([
        { id: 'input1', name: 'Name', value: 'John' },
        { id: 'input2', name: 'Age', value: 25 },
        { id: 'input3', name: 'Email' },
      ])
    })

    it.concurrent('should preserve all other fields including value', () => {
      const inputFormat = [
        {
          id: 'input1',
          name: 'Complex Input',
          value: 'test-value',
          collapsed: true,
          type: 'string',
          required: true,
          validation: { min: 0, max: 100 },
        },
      ]
      const result = sanitizeInputFormat(inputFormat)

      expect(result[0]).toEqual({
        id: 'input1',
        name: 'Complex Input',
        value: 'test-value',
        type: 'string',
        required: true,
        validation: { min: 0, max: 100 },
      })
    })

    it.concurrent('should handle empty array', () => {
      expect(sanitizeInputFormat([])).toEqual([])
    })
  })

  describe('normalizeEdge', () => {
    it.concurrent('should extract only connection-relevant fields', () => {
      const edge = {
        id: 'edge1',
        source: 'block1',
        sourceHandle: 'output',
        target: 'block2',
        targetHandle: 'input',
        type: 'smoothstep',
        animated: true,
        style: { stroke: 'red' },
        data: { label: 'connection' },
      }
      const result = normalizeEdge(edge)

      expect(result).toEqual({
        source: 'block1',
        sourceHandle: 'output',
        target: 'block2',
        targetHandle: 'input',
      })
    })

    it.concurrent('should handle edges without handles', () => {
      const edge = {
        id: 'edge1',
        source: 'block1',
        target: 'block2',
      }
      const result = normalizeEdge(edge)

      expect(result).toEqual({
        source: 'block1',
        sourceHandle: undefined,
        target: 'block2',
        targetHandle: undefined,
      })
    })

    it.concurrent('should handle edges with only source handle', () => {
      const edge = {
        id: 'edge1',
        source: 'block1',
        sourceHandle: 'output',
        target: 'block2',
      }
      const result = normalizeEdge(edge)

      expect(result).toEqual({
        source: 'block1',
        sourceHandle: 'output',
        target: 'block2',
        targetHandle: undefined,
      })
    })
  })

  describe('sortEdges', () => {
    it.concurrent('should sort edges consistently', () => {
      const edges = [
        { source: 'c', target: 'd' },
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ]
      const result = sortEdges(edges)

      expect(result[0].source).toBe('a')
      expect(result[1].source).toBe('b')
      expect(result[2].source).toBe('c')
    })

    it.concurrent(
      'should sort by source, then sourceHandle, then target, then targetHandle',
      () => {
        const edges = [
          { source: 'a', sourceHandle: 'out2', target: 'b', targetHandle: 'in1' },
          { source: 'a', sourceHandle: 'out1', target: 'b', targetHandle: 'in1' },
          { source: 'a', sourceHandle: 'out1', target: 'b', targetHandle: 'in2' },
          { source: 'a', sourceHandle: 'out1', target: 'c', targetHandle: 'in1' },
        ]
        const result = sortEdges(edges)

        expect(result[0]).toEqual({
          source: 'a',
          sourceHandle: 'out1',
          target: 'b',
          targetHandle: 'in1',
        })
        expect(result[1]).toEqual({
          source: 'a',
          sourceHandle: 'out1',
          target: 'b',
          targetHandle: 'in2',
        })
        expect(result[2]).toEqual({
          source: 'a',
          sourceHandle: 'out1',
          target: 'c',
          targetHandle: 'in1',
        })
        expect(result[3]).toEqual({
          source: 'a',
          sourceHandle: 'out2',
          target: 'b',
          targetHandle: 'in1',
        })
      }
    )

    it.concurrent('should not mutate the original array', () => {
      const edges = [
        { source: 'c', target: 'd' },
        { source: 'a', target: 'b' },
      ]
      const originalFirst = edges[0]
      sortEdges(edges)

      expect(edges[0]).toBe(originalFirst)
    })

    it.concurrent('should handle empty array', () => {
      expect(sortEdges([])).toEqual([])
    })

    it.concurrent('should handle edges with undefined handles', () => {
      const edges = [
        { source: 'b', target: 'c' },
        { source: 'a', target: 'b', sourceHandle: 'out' },
      ]
      const result = sortEdges(edges)

      expect(result[0].source).toBe('a')
      expect(result[1].source).toBe('b')
    })

    it.concurrent('should produce identical results regardless of input order', () => {
      const edges1 = [
        { source: 'c', sourceHandle: 'x', target: 'd', targetHandle: 'y' },
        { source: 'a', sourceHandle: 'x', target: 'b', targetHandle: 'y' },
        { source: 'b', sourceHandle: 'x', target: 'c', targetHandle: 'y' },
      ]
      const edges2 = [
        { source: 'a', sourceHandle: 'x', target: 'b', targetHandle: 'y' },
        { source: 'b', sourceHandle: 'x', target: 'c', targetHandle: 'y' },
        { source: 'c', sourceHandle: 'x', target: 'd', targetHandle: 'y' },
      ]
      const edges3 = [
        { source: 'b', sourceHandle: 'x', target: 'c', targetHandle: 'y' },
        { source: 'c', sourceHandle: 'x', target: 'd', targetHandle: 'y' },
        { source: 'a', sourceHandle: 'x', target: 'b', targetHandle: 'y' },
      ]

      const result1 = normalizedStringify(sortEdges(edges1))
      const result2 = normalizedStringify(sortEdges(edges2))
      const result3 = normalizedStringify(sortEdges(edges3))

      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    })
  })
})
