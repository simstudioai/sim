import { describe, expect, it } from 'vitest'
import {
  formatOutputSelector,
  parseOutputSelector,
  scopeOutputBlockId,
  selectChildOutputSelectors,
} from '@/lib/workflows/streaming/output-selector'

describe('output selector scoping', () => {
  it('preserves root selectors and parses nested selectors', () => {
    expect(parseOutputSelector('agent_content')).toEqual({
      blockId: 'agent',
      path: 'content',
    })
    expect(parseOutputSelector('workflow/agent_content.text')).toEqual({
      blockId: 'workflow/agent',
      path: 'content.text',
    })
    expect(parseOutputSelector('agent')).toEqual({
      blockId: 'agent',
      path: '',
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

  it.each(['', ' workflow/agent_content', '/agent_content', 'workflow//agent_content'])(
    'fails fast for malformed selector %j',
    (selector) => {
      expect(() => parseOutputSelector(selector)).toThrow('Invalid')
    }
  )
})
