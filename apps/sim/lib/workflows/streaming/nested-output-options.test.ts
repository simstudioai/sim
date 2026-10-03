import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workflows/blocks/flatten-outputs', () => ({
  flattenWorkflowOutputs: (blocks: Iterable<{ id: string; name: string; type: string }>) =>
    [...blocks]
      .filter((candidate) => candidate.type === 'agent')
      .map((candidate) => ({
        blockId: candidate.id,
        blockName: candidate.name,
        blockType: candidate.type,
        path: 'content',
      })),
}))

import {
  buildWorkflowOutputMenu,
  buildWorkflowOutputOptions,
  collectReferencedWorkflowIds,
  getWorkflowInvocationTarget,
} from '@/lib/workflows/streaming/nested-output-options'

function block(id: string, type: string, name: string, subBlocks = {}, data = {}) {
  return {
    id,
    type,
    name,
    subBlocks,
    data,
    position: { x: 0, y: 0 },
    outputs: {},
    enabled: true,
  }
}

describe('nested workflow output options', () => {
  it('uses the active canonical workflow ID', () => {
    const workflowBlock = block(
      'invoke',
      'workflow_input',
      'Research',
      {
        workflowId: { value: 'basic-workflow' },
        manualWorkflowId: { value: 'advanced-workflow' },
      },
      { canonicalModes: { workflowId: 'advanced' } }
    )

    expect(getWorkflowInvocationTarget(workflowBlock)).toBe('advanced-workflow')
  })

  it('builds workflow-scoped selectors and stops cycles', () => {
    const root = {
      blocks: {
        invoke: block('invoke', 'workflow_input', 'Research', {
          workflowId: { value: 'child-workflow' },
        }),
      },
      edges: [],
    }
    const child = {
      blocks: {
        agent: block('agent', 'agent', 'Writer'),
        cycle: block('cycle', 'workflow_input', 'Back to root', {
          workflowId: { value: 'root-workflow' },
        }),
      },
      edges: [],
    }

    expect(collectReferencedWorkflowIds([root])).toEqual(['child-workflow'])
    const options = buildWorkflowOutputOptions({
      rootWorkflowId: 'root-workflow',
      rootState: root,
      workflowStates: new Map([
        ['child-workflow', child],
        ['root-workflow', root],
      ]),
      maxChildDepth: 3,
    })

    expect(
      options.some(
        (option) =>
          option.id === 'child-workflow.agent_content' &&
          option.label === 'child-workflow.writer.content'
      )
    ).toBe(true)
    expect(options.some((option) => option.menuPath.length > 2)).toBe(false)

    expect(buildWorkflowOutputMenu(options)).toMatchObject([
      {
        blockId: 'invoke',
        blockName: 'Research',
        blockType: 'workflow_input',
        outputs: [],
        children: [
          {
            blockId: 'invoke/agent',
            blockName: 'Writer',
            blockType: 'agent',
            outputs: [{ id: 'child-workflow.agent_content', path: 'content' }],
            children: [],
          },
        ],
      },
    ])
  })
})
