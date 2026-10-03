import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it } from 'vitest'
import { getBlockReferenceTags } from '@/lib/workflows/blocks/block-reference-tags'
import { getAllBlocks, getBlock } from '@/blocks/registry'

const mockGetBlock = getBlock as Mock
const mockGetAllBlocks = getAllBlocks as Mock
mockGetAllBlocks.mockImplementation(() => ({}))

describe('getBlockReferenceTags', () => {
  beforeEach(() => {
    mockGetBlock.mockReset()
    mockGetBlock.mockReturnValue({
      outputs: {
        content: { type: 'string' },
        model: { type: 'string' },
      },
      subBlocks: [],
    })
  })

  it('returns agent responseFormat fields instead of default outputs', () => {
    const tags = getBlockReferenceTags({
      block: {
        id: 'agent-1',
        type: 'agent',
        name: 'Classify Email',
        subBlocks: {
          responseFormat: {
            value: {
              name: 'email_classification',
              schema: {
                type: 'object',
                properties: {
                  isImportant: { type: 'boolean' },
                  draftReply: { type: 'string' },
                  reason: { type: 'string' },
                },
                required: ['isImportant', 'draftReply', 'reason'],
                additionalProperties: false,
              },
              strict: true,
            },
          },
        },
      },
    })

    expect(tags).toEqual([
      'classifyemail.isImportant',
      'classifyemail.draftReply',
      'classifyemail.reason',
    ])
  })

  it('returns variables block assignments as block tags', () => {
    const tags = getBlockReferenceTags({
      block: {
        id: 'variables-1',
        type: 'variables',
        name: 'Workflow Vars',
        subBlocks: {
          variables: {
            value: [{ variableName: 'currentDraft' }, { variableName: 'needsRevision' }],
          },
        },
      },
    })

    expect(tags).toEqual(['workflowvars.currentDraft', 'workflowvars.needsRevision'])
  })
})
