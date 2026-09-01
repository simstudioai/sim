import { describe, expect, it } from 'vitest'
import { resolveOutputSelectors } from '@/lib/workflows/streaming/resolve-output-selectors'

const ROOT_BLOCK_ID = '11111111-1111-4111-8111-111111111111'
const CHILD_WORKFLOW_ID = '22222222-2222-4222-8222-222222222222'

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

describe('resolveOutputSelectors', () => {
  it('resolves current names and defers child names to the authorized child loader', () => {
    expect(
      resolveOutputSelectors({
        selectedOutputs: [
          'rootagent.result.text',
          `${CHILD_WORKFLOW_ID}.answer_writer.result.text`,
        ],
        currentBlocks: { [ROOT_BLOCK_ID]: block(ROOT_BLOCK_ID, 'Root Agent') },
      })
    ).toEqual([`${ROOT_BLOCK_ID}_result.text`, `${CHILD_WORKFLOW_ID}.answer%5Fwriter_result.text`])
  })

  it('rejects invocation-scoped slash selectors', () => {
    expect(() =>
      resolveOutputSelectors({
        selectedOutputs: ['workflow-block/agent.content'],
        currentBlocks: { [ROOT_BLOCK_ID]: block(ROOT_BLOCK_ID, 'Root Agent') },
      })
    ).toThrow('Invalid output selector')
  })

  it('uses referenced workflow IDs even when the ID is not UUID-shaped', () => {
    const invocation = {
      ...block('invoke', 'Research'),
      type: 'workflow_input',
      subBlocks: { workflowId: { value: 'child-workflow' } },
    }

    expect(
      resolveOutputSelectors({
        selectedOutputs: ['child-workflow.writer.content'],
        currentBlocks: { invoke: invocation },
      })
    ).toEqual(['child-workflow.writer_content'])
  })

  it('does not reinterpret an unknown root block name as a child workflow', () => {
    expect(() =>
      resolveOutputSelectors({
        selectedOutputs: ['missing.result.text'],
        currentBlocks: { [ROOT_BLOCK_ID]: block(ROOT_BLOCK_ID, 'Root Agent') },
      })
    ).toThrow('Selected output block does not resolve: missing')
  })
})
