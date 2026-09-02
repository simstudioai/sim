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
    ).toThrow(
      'Unknown block "missing" in selector "missing.result.text". Available blocks: Root Agent'
    )
  })

  it('names every available block when a selector head matches none, in either name form', () => {
    const OTHER_BLOCK_ID = '33333333-3333-4333-8333-333333333333'
    const currentBlocks = {
      [ROOT_BLOCK_ID]: block(ROOT_BLOCK_ID, 'Root Agent'),
      [OTHER_BLOCK_ID]: block(OTHER_BLOCK_ID, 'Start'),
    }

    expect(() =>
      resolveOutputSelectors({ selectedOutputs: ['Agent 2.content'], currentBlocks })
    ).toThrow(
      'Unknown block "Agent 2" in selector "Agent 2.content". Available blocks: Root Agent, Start'
    )
    expect(
      resolveOutputSelectors({
        selectedOutputs: ['Root Agent.content', 'rootagent.content', OTHER_BLOCK_ID],
        currentBlocks,
      })
    ).toEqual([`${ROOT_BLOCK_ID}_content`, `${ROOT_BLOCK_ID}_content`, OTHER_BLOCK_ID])
  })

  it('keeps the resolver error for an ambiguous name rather than calling it unknown', () => {
    const OTHER_BLOCK_ID = '33333333-3333-4333-8333-333333333333'

    expect(() =>
      resolveOutputSelectors({
        selectedOutputs: ['agent.content'],
        currentBlocks: {
          [ROOT_BLOCK_ID]: block(ROOT_BLOCK_ID, 'Agent'),
          [OTHER_BLOCK_ID]: block(OTHER_BLOCK_ID, 'agent'),
        },
      })
    ).toThrow('Selected output block does not resolve: agent')
  })
})
