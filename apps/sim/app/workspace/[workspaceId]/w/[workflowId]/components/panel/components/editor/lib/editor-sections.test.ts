import { describe, expect, it } from 'vitest'
import { groupSubBlocksIntoEditorSections } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/lib/editor-sections'
import type { SubBlockConfig } from '@/blocks/types'

function subBlock(id: string, extras: Partial<SubBlockConfig> = {}): SubBlockConfig {
  return { id, type: 'short-input', ...extras }
}

describe('groupSubBlocksIntoEditorSections', () => {
  it('groups API request fields by responsibility', () => {
    const sections = groupSubBlocksIntoEditorSections('api', [
      subBlock('url'),
      subBlock('method'),
      subBlock('headers'),
      subBlock('body'),
      subBlock('timeout', { mode: 'advanced' }),
    ])

    expect(sections?.map((section) => section.id)).toEqual(['request', 'request-data', 'execution'])
    expect(sections?.[1].subBlocks.map((field) => field.id)).toEqual(['headers', 'body'])
  })

  it('keeps agent model, context, memory, generation, and output settings distinct', () => {
    const sections = groupSubBlocksIntoEditorSections('agent', [
      subBlock('messages'),
      subBlock('model'),
      subBlock('apiKey'),
      subBlock('tools'),
      subBlock('memoryType'),
      subBlock('thinkingLevel'),
      subBlock('responseFormat'),
    ])

    expect(sections?.map((section) => section.id)).toEqual([
      'messages',
      'model',
      'context',
      'memory',
      'generation',
      'output',
    ])
  })

  it('keeps integration connections and standalone options out of primary inputs', () => {
    const sections = groupSubBlocksIntoEditorSections('slack_v2', [
      subBlock('operation'),
      subBlock('credential'),
      subBlock('channel'),
      subBlock('manualChannel', { mode: 'advanced', canonicalParamId: 'channel' }),
      subBlock('paginationCursor', { mode: 'advanced' }),
    ])

    expect(sections?.find((section) => section.id === 'connection')?.subBlocks).toHaveLength(1)
    expect(
      sections?.find((section) => section.id === 'inputs')?.subBlocks.map((field) => field.id)
    ).toEqual(['channel', 'manualChannel'])
    expect(sections?.find((section) => section.id === 'options')?.subBlocks).toHaveLength(1)
  })

  it('leaves blocks outside the prototype set unchanged', () => {
    expect(groupSubBlocksIntoEditorSections('function', [subBlock('code')])).toBeNull()
  })
})
