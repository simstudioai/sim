import { describe, expect, it } from 'vitest'
import {
  formatInternalOutputSelector,
  formatPublicOutputSelector,
  parseInternalOutputSelector,
  parsePublicOutputSelector,
  parseStoredOutputSelector,
  scopeOutputBlockId,
  selectChildOutputSelectors,
} from '@/lib/workflows/streaming/output-selector'

const CHILD_WORKFLOW_ID = '11111111-1111-4111-8111-111111111111'
const CHILD_BLOCK_ID = '22222222-2222-4222-8222-222222222222'

function block(id: string, name: string) {
  return {
    id,
    type: 'agent',
    name,
    subBlocks: {},
    position: { x: 0, y: 0 },
    outputs: {},
    enabled: true,
  }
}

describe('output selector scoping', () => {
  it('parses root and workflow-scoped internal selectors', () => {
    expect(parseInternalOutputSelector('agent_content')).toEqual({
      blockId: 'agent',
      path: 'content',
    })
    expect(
      parseInternalOutputSelector(`${CHILD_WORKFLOW_ID}.${CHILD_BLOCK_ID}_content.text`)
    ).toEqual({
      workflowId: CHILD_WORKFLOW_ID,
      blockId: CHILD_BLOCK_ID,
      path: 'content.text',
    })
  })

  it('uses current workflow block refs to distinguish nested selectors from dotted paths', () => {
    const currentBlockRefs = new Set(['rootagent'])

    expect(parsePublicOutputSelector('rootagent.result.text', { currentBlockRefs })).toEqual({
      blockId: 'rootagent',
      path: 'result.text',
    })
    expect(
      parsePublicOutputSelector(`${CHILD_WORKFLOW_ID}.writer.result.text`, {
        currentBlockRefs,
      })
    ).toEqual({
      workflowId: CHILD_WORKFLOW_ID,
      blockId: 'writer',
      path: 'result.text',
    })
  })

  it('recognizes stable stored internal selectors without confusing public underscores', () => {
    const currentBlockRefs = new Set([CHILD_BLOCK_ID])

    expect(
      parseStoredOutputSelector(`${CHILD_BLOCK_ID}_content.text`, { currentBlockRefs })
    ).toEqual({
      blockId: CHILD_BLOCK_ID,
      path: 'content.text',
    })
    expect(parseStoredOutputSelector('my_agent.content', { currentBlockRefs })).toEqual({
      blockId: 'my_agent',
      path: 'content',
    })
  })

  it('formats workflow-scoped selectors without invocation paths', () => {
    expect(formatPublicOutputSelector('writer', 'content', CHILD_WORKFLOW_ID)).toBe(
      `${CHILD_WORKFLOW_ID}.writer.content`
    )
    expect(formatInternalOutputSelector(CHILD_BLOCK_ID, 'content', CHILD_WORKFLOW_ID)).toBe(
      `${CHILD_WORKFLOW_ID}.${CHILD_BLOCK_ID}_content`
    )
    expect(scopeOutputBlockId(CHILD_WORKFLOW_ID, CHILD_BLOCK_ID)).toBe(
      `${CHILD_WORKFLOW_ID}.${CHILD_BLOCK_ID}`
    )
  })

  it('routes direct selections locally and forwards descendant workflow selections', () => {
    const descendantWorkflowId = '33333333-3333-4333-8333-333333333333'
    const directSelector = formatInternalOutputSelector('writer', 'content', CHILD_WORKFLOW_ID)
    const descendantSelector = formatInternalOutputSelector(
      'reviewer',
      'result.text',
      descendantWorkflowId
    )

    const selection = selectChildOutputSelectors(
      CHILD_WORKFLOW_ID,
      { [CHILD_BLOCK_ID]: block(CHILD_BLOCK_ID, 'Writer') },
      ['root_content', directSelector, descendantSelector]
    )

    expect(selection.selectedOutputs).toEqual([`${CHILD_BLOCK_ID}_content`, descendantSelector])
    expect(selection.selectedBlockRefs.get(CHILD_BLOCK_ID)).toBe('writer')
    expect(selection.targetsChildWorkflow).toBe(true)
  })

  it.each([
    '',
    ' workflow.agent_content',
    'workflow/agent_content',
    '.agent_content',
    'workflow..agent_content',
    'agent_',
    'agent_content.',
    'agent_content..text',
  ])('fails fast for malformed selector %j', (selector) => {
    expect(() => parseInternalOutputSelector(selector)).toThrow('Invalid')
  })
})
