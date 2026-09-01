import { describe, expect, it } from 'vitest'
import {
  formatOutputSelector,
  parseInternalOutputSelector,
  parsePublicOutputSelector,
  parseStoredOutputSelector,
  scopeOutputBlockId,
  selectChildOutputSelectors,
} from '@/lib/workflows/streaming/output-selector'

describe('output selector scoping', () => {
  it('preserves root selectors and parses nested selectors', () => {
    expect(parseInternalOutputSelector('agent_content')).toEqual({
      blockId: 'agent',
      path: 'content',
    })
    expect(parseInternalOutputSelector('workflow/agent_content.text')).toEqual({
      blockId: 'workflow/agent',
      path: 'content.text',
    })
    expect(parseInternalOutputSelector('agent')).toEqual({
      blockId: 'agent',
      path: '',
    })
  })

  it('preserves underscores in caller-facing block IDs', () => {
    for (const parse of [parsePublicOutputSelector, parseStoredOutputSelector]) {
      expect(parse('workflow_block/agent_name.content')).toEqual({
        blockId: 'workflow_block/agent_name',
        path: 'content',
      })
    }
  })

  it('recognizes canonical stored internal selectors with dotted paths', () => {
    const workflowBlockId = '11111111-1111-4111-8111-111111111111'
    const agentBlockId = '22222222-2222-4222-8222-222222222222'

    expect(parseStoredOutputSelector(`${workflowBlockId}/${agentBlockId}_content.text`)).toEqual({
      blockId: `${workflowBlockId}/${agentBlockId}`,
      path: 'content.text',
    })
  })

  it('scopes block IDs through multiple workflow invocations', () => {
    expect(scopeOutputBlockId('outer-workflow', 'inner-workflow/agent')).toBe(
      'outer-workflow/inner-workflow/agent'
    )
    expect(formatOutputSelector('outer-workflow/agent', 'content')).toBe(
      'outer-workflow/agent_content'
    )
  })

  it('selects and strips only outputs addressed to the child invocation', () => {
    expect(
      selectChildOutputSelectors('workflow-a', [
        'root_content',
        'workflow-b/agent_content',
        'workflow-a/agent_content',
        'workflow-a/nested-workflow/agent_content.text',
      ])
    ).toEqual(['agent_content', 'nested-workflow/agent_content.text'])
  })

  it.each([
    '',
    ' workflow/agent_content',
    '/agent_content',
    'workflow//agent_content',
    'agent_.content',
    'agent_content.',
    'agent_content..text',
  ])('fails fast for malformed selector %j', (selector) => {
    expect(() => parseInternalOutputSelector(selector)).toThrow('Invalid')
  })
})
