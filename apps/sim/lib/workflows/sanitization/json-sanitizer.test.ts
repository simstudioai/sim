/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Builds a minimal one-block workflow whose knowledge block carries the two
 * subblock keys `edit_workflow` is allowed to write.
 */
function makeKnowledgeWorkflow(tagFiltersValue: unknown) {
  return {
    blocks: {
      'kb-1': {
        id: 'kb-1',
        type: 'knowledge',
        name: 'Knowledge 1',
        position: { x: 0, y: 0 },
        enabled: true,
        outputs: {},
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'search' },
          tagFilters: { id: 'tagFilters', type: 'knowledge-tag-filters', value: tagFiltersValue },
          documentTags: {
            id: 'documentTags',
            type: 'document-tag-entry',
            value: JSON.stringify([{ id: 't1', tagName: 'Team' }]),
          },
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  } as unknown as WorkflowState
}

describe('sanitizeForCopilot knowledge tag subblocks', () => {
  // Regression: these keys were stripped, which made them write-only for the agent --
  // edit_workflow could set a tag filter but the agent read back an absent field and
  // cleared the user's filter on the next edit.
  it('retains tagFilters so the agent can read back what edit_workflow writes', () => {
    const value = JSON.stringify([
      { id: 'f1', tagName: 'Department', tagSlot: 'tag1', tagValue: 'it' },
    ])

    const result = sanitizeForCopilot(makeKnowledgeWorkflow(value))
    const inputs = result.blocks['kb-1'].inputs

    expect(inputs?.tagFilters).toBe(value)
  })

  it('retains documentTags alongside tagFilters', () => {
    const result = sanitizeForCopilot(makeKnowledgeWorkflow(JSON.stringify([])))
    const inputs = result.blocks['kb-1'].inputs

    expect(inputs?.documentTags).toBeDefined()
  })

  it('still omits the key when no filter is set, so absent means unset', () => {
    const result = sanitizeForCopilot(makeKnowledgeWorkflow(null))
    const inputs = result.blocks['kb-1'].inputs

    expect(inputs).not.toHaveProperty('tagFilters')
  })
})
