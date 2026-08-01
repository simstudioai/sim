import { describe, expect, it } from 'vitest'
import { resolveCanvasBlockPresentation } from '@/lib/workflows/blocks/canvas-presentation'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

const operationSubBlock = {
  id: 'operation',
  title: 'Operation',
  type: 'dropdown',
  options: [
    { label: 'Send Email', id: 'send_gmail' },
    { label: 'Search Email', id: 'search_gmail' },
  ],
} as SubBlockConfig

const gmailConfig = {
  name: 'Gmail',
  subBlocks: [operationSubBlock],
  canvasPresentation: {
    typeLabel: 'Gmail',
    defaultTitle: 'Send Email',
    operationSubBlockId: 'operation',
    operationRowTitle: 'Action',
  },
} as Pick<BlockConfig, 'name' | 'subBlocks' | 'canvasPresentation'>

describe('resolveCanvasBlockPresentation', () => {
  it('uses the selected operation for an auto-generated block name', () => {
    expect(
      resolveCanvasBlockPresentation(gmailConfig, 'Gmail 1', { operation: 'search_gmail' })
    ).toEqual({
      title: 'Search Email',
      typeLabel: 'Gmail',
      usesDefaultTitle: true,
      operationSubBlockId: 'operation',
      operationRowTitle: 'Action',
    })
  })

  it('keeps a custom title and exposes operation row metadata', () => {
    expect(
      resolveCanvasBlockPresentation(gmailConfig, 'Customer Welcome', {
        operation: 'send_gmail',
      })
    ).toEqual({
      title: 'Customer Welcome',
      typeLabel: 'Gmail',
      usesDefaultTitle: false,
      operationSubBlockId: 'operation',
      operationRowTitle: 'Action',
    })
  })

  it('uses a static semantic title for a block without an operation selector', () => {
    const humanConfig = {
      name: 'Human in the Loop',
      subBlocks: [],
      canvasPresentation: {
        typeLabel: 'Human',
        defaultTitle: 'Wait for Input',
      },
    } as Pick<BlockConfig, 'name' | 'subBlocks' | 'canvasPresentation'>

    expect(resolveCanvasBlockPresentation(humanConfig, 'Human in the Loop 1', {})).toEqual({
      title: 'Wait for Input',
      typeLabel: 'Human',
      usesDefaultTitle: true,
      operationSubBlockId: undefined,
      operationRowTitle: undefined,
    })
  })
})
