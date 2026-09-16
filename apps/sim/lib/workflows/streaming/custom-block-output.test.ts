/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { selectCustomBlockStreamingOutputs } from '@/lib/workflows/streaming/custom-block-output'

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
})
