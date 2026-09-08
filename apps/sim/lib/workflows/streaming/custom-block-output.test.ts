/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  assertCustomBlockStreamingOutputs,
  isCustomBlockStreamSource,
  selectCustomBlockStreamingOutputs,
} from '@/lib/workflows/streaming/custom-block-output'

const answer = { blockId: 'private-agent', path: 'content', name: 'answer_text', streaming: true }

describe('custom block streaming outputs', () => {
  it('maps only selected public fields, preserving the existing selector syntax', () => {
    const selection = selectCustomBlockStreamingOutputs(
      'custom-instance',
      [answer, { blockId: 'other-agent', path: 'content', name: 'summary' }],
      ['custom-instance_answer_text', 'custom-instance_summary', 'unrelated_answer_text']
    )
    expect(selection.selectedOutputs).toEqual(['private-agent_content'])
    expect([...selection.outputsByBlockId.values()]).toEqual([answer])
    expect(
      selectCustomBlockStreamingOutputs('custom-instance', [answer], []).selectedOutputs
    ).toEqual([])
  })

  it.each(['agent', 'pi'])('accepts unstructured %s content', (type) => {
    expect(
      isCustomBlockStreamSource({ type, subBlocks: { responseFormat: { value: '' } } }, 'content')
    ).toBe(true)
  })

  it('rejects unsupported, removed, and structured sources', () => {
    for (const blocks of [
      {},
      { 'private-agent': { type: 'api' } },
      {
        'private-agent': {
          type: 'agent',
          subBlocks: { responseFormat: { value: '{"type":"object"}' } },
        },
      },
    ]) {
      expect(() => assertCustomBlockStreamingOutputs([answer], blocks)).toThrow('must reference')
    }
    expect(() =>
      assertCustomBlockStreamingOutputs([{ ...answer, path: 'thinking' }], {
        'private-agent': { type: 'agent' },
      })
    ).toThrow('must reference')
  })

  it('rejects ambiguous mappings and nested public names', () => {
    const blocks = { 'private-agent': { type: 'agent' } }
    expect(() =>
      assertCustomBlockStreamingOutputs([answer, { ...answer, name: 'other' }], blocks)
    ).toThrow('only once')
    expect(() =>
      assertCustomBlockStreamingOutputs([{ ...answer, name: 'answer.text' }], blocks)
    ).toThrow('single output field')
  })

  it('leaves final-only outputs compatible with arbitrary source types', () => {
    expect(() =>
      assertCustomBlockStreamingOutputs([{ ...answer, streaming: false }], {})
    ).not.toThrow()
  })
})
