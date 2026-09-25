/**
 * Tests for workflow normalization utilities
 */
import { describe, expect, it } from 'vitest'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'
import {
  extractBlockFieldsForComparison,
  filterSubBlockIds,
  normalizedStringify,
  normalizeEdge,
  normalizeLoop,
  normalizeParallel,
  normalizeTriggerConfigValues,
  normalizeValue,
  sanitizeInputFormat,
  sanitizeTools,
  sanitizeVariable,
  sortEdges,
} from './normalize'

describe('Workflow Normalization Utilities', () => {
  describe('normalizeValue', () => {
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
  })

  describe('sanitizeVariable', () => {
    it.concurrent('removes UI-only fields without changing persisted values', () => {
      expect(
        sanitizeVariable({
          id: 'variable-a',
          workflowId: 'workflow-a',
          name: 'Optional payload',
          type: 'object',
          value: null,
          validationError: 'invalid',
        })
      ).toEqual({
        id: 'variable-a',
        name: 'Optional payload',
        type: 'object',
        value: null,
      })
    })
  })

  describe('normalizeLoop', () => {
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
  })

  describe('sanitizeTools', () => {
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
  })

  describe('sanitizeInputFormat', () => {
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

  describe('filterSubBlockIds', () => {
    it.concurrent('should exclude exact SYSTEM_SUBBLOCK_IDS', () => {
      const ids = ['signingSecret', 'samplePayload', 'triggerInstructions', 'botToken']
      const result = filterSubBlockIds(ids)
      expect(result).toEqual(['botToken', 'signingSecret'])
    })

    it.concurrent('should exclude namespaced SYSTEM_SUBBLOCK_IDS (prefix matching)', () => {
      const ids = [
        'signingSecret',
        'samplePayload_slack_webhook',
        'triggerInstructions_slack_webhook',
        'webhookUrlDisplay_slack_webhook',
        'botToken',
      ]
      const result = filterSubBlockIds(ids)
      expect(result).toEqual(['botToken', 'signingSecret'])
    })

    it.concurrent('should exclude exact TRIGGER_RUNTIME_SUBBLOCK_IDS', () => {
      const ids = ['webhookId', 'triggerPath', 'triggerConfig', 'triggerId', 'signingSecret']
      const result = filterSubBlockIds(ids)
      expect(result).toEqual(['signingSecret'])
    })

    it.concurrent('should not exclude IDs that merely contain a system ID substring', () => {
      const ids = ['mySamplePayload', 'notSamplePayload']
      const result = filterSubBlockIds(ids)
      expect(result).toEqual(['mySamplePayload', 'notSamplePayload'])
    })

    it.concurrent('should exclude synthetic tool-input subBlock IDs', () => {
      const ids = [
        'toolConfig',
        'toolConfig-tool-0-query',
        'toolConfig-tool-0-url',
        'toolConfig-tool-1-status',
        'systemPrompt',
      ]
      const result = filterSubBlockIds(ids)
      expect(result).toEqual(['systemPrompt', 'toolConfig'])
    })
  })

  describe('normalizeTriggerConfigValues', () => {
    it.concurrent('should return subBlocks unchanged when no triggerConfig exists', () => {
      const subBlocks = {
        signingSecret: { id: 'signingSecret', type: 'short-input', value: 'secret123' },
        botToken: { id: 'botToken', type: 'short-input', value: 'token456' },
      }
      const result = normalizeTriggerConfigValues(subBlocks)
      expect(result).toEqual(subBlocks)
    })

    it.concurrent(
      'should return subBlocks unchanged when triggerConfig value is not an object',
      () => {
        const subBlocks = {
          triggerConfig: { id: 'triggerConfig', type: 'short-input', value: 'string-value' },
          signingSecret: { id: 'signingSecret', type: 'short-input', value: null },
        }
        const result = normalizeTriggerConfigValues(subBlocks)
        expect(result).toEqual(subBlocks)
      }
    )

    it.concurrent('should populate null individual fields from triggerConfig', () => {
      const subBlocks = {
        triggerConfig: {
          id: 'triggerConfig',
          type: 'short-input',
          value: { signingSecret: 'secret123', botToken: 'token456' },
        },
        signingSecret: { id: 'signingSecret', type: 'short-input', value: null },
        botToken: { id: 'botToken', type: 'short-input', value: null },
      }
      const result = normalizeTriggerConfigValues(subBlocks)
      expect((result.signingSecret as Record<string, unknown>).value).toBe('secret123')
      expect((result.botToken as Record<string, unknown>).value).toBe('token456')
    })

    it.concurrent('should NOT overwrite existing non-empty individual field values', () => {
      const subBlocks = {
        triggerConfig: {
          id: 'triggerConfig',
          type: 'short-input',
          value: { signingSecret: 'old-secret' },
        },
        signingSecret: { id: 'signingSecret', type: 'short-input', value: 'user-edited-secret' },
      }
      const result = normalizeTriggerConfigValues(subBlocks)
      expect((result.signingSecret as Record<string, unknown>).value).toBe('user-edited-secret')
    })
  })

  describe('extractBlockFieldsForComparison', () => {
    function createBlock(overrides: Partial<BlockState> = {}): BlockState {
      return {
        id: 'block-1',
        type: 'agent',
        name: 'Test',
        enabled: true,
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        ...overrides,
      } as BlockState
    }

    it.concurrent('should strip the locked field from blockRest', () => {
      const { blockRest } = extractBlockFieldsForComparison(createBlock({ locked: true }))
      expect((blockRest as Record<string, unknown>).locked).toBeUndefined()
    })

    it.concurrent(
      'should yield identical blockRest when only locked differs between two blocks',
      () => {
        const lockedBlock = createBlock({ locked: true })
        const unlockedBlock = createBlock({ locked: false })
        const { blockRest: lockedRest } = extractBlockFieldsForComparison(lockedBlock)
        const { blockRest: unlockedRest } = extractBlockFieldsForComparison(unlockedBlock)
        expect(normalizedStringify(lockedRest)).toBe(normalizedStringify(unlockedRest))
      }
    )
  })
})
