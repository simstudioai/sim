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
  it('shows the block its own name, never the current operation', () => {
    /* The heading used to float to the selected operation whenever the name
       looked auto-generated, so a card headed "Search Email" was referenced as
       `<gmail1.content>` — canvas and tag dropdown disagreed on its name. */
    expect(
      resolveCanvasBlockPresentation(gmailConfig, 'Gmail 1', { operation: 'search_gmail' })
    ).toEqual({
      title: 'Gmail 1',
      typeLabel: 'Gmail',
      titleShowsOperation: false,
      operationSubBlockId: 'operation',
      operationRowTitle: 'Action',
    })
  })

  it('hides the operation row when the name already says the operation', () => {
    expect(
      resolveCanvasBlockPresentation(gmailConfig, 'Send Email', { operation: 'send_gmail' })
    ).toMatchObject({ title: 'Send Email', titleShowsOperation: true })
  })

  it('ignores the copy number, which only tells two cards apart', () => {
    expect(
      resolveCanvasBlockPresentation(gmailConfig, 'Send Email 2', { operation: 'send_gmail' })
    ).toMatchObject({ title: 'Send Email 2', titleShowsOperation: true })
  })

  it('shows the operation row once the name no longer says the operation', () => {
    /* Either because the user renamed it, or because they switched operation
       after the block was named for a different one. */
    expect(
      resolveCanvasBlockPresentation(gmailConfig, 'Customer Welcome', { operation: 'send_gmail' })
    ).toEqual({
      title: 'Customer Welcome',
      typeLabel: 'Gmail',
      titleShowsOperation: false,
      operationSubBlockId: 'operation',
      operationRowTitle: 'Action',
    })

    expect(
      resolveCanvasBlockPresentation(gmailConfig, 'Send Email', { operation: 'search_gmail' })
    ).toMatchObject({ title: 'Send Email', titleShowsOperation: false })
  })

  it('keeps the stored name for a block with no operation selector', () => {
    const humanConfig = {
      name: 'Human',
      subBlocks: [],
      canvasPresentation: {
        typeLabel: 'Human',
        defaultTitle: 'Wait for Input',
      },
    } as Pick<BlockConfig, 'name' | 'subBlocks' | 'canvasPresentation'>

    /* No operation selector means no operation row to suppress, so the flag is
       vacuously false — every consumer of it also guards on `operationSubBlockId`. */
    expect(resolveCanvasBlockPresentation(humanConfig, 'Human in the Loop 1', {})).toEqual({
      title: 'Human in the Loop 1',
      typeLabel: 'Human',
      titleShowsOperation: false,
      operationSubBlockId: undefined,
      operationRowTitle: undefined,
    })
  })

  it('keeps the stored name for a block with no canvasPresentation at all', () => {
    const bareConfig = { name: 'Custom', subBlocks: [] } as Pick<
      BlockConfig,
      'name' | 'subBlocks' | 'canvasPresentation'
    >

    expect(resolveCanvasBlockPresentation(bareConfig, 'My Step', {})).toEqual({
      title: 'My Step',
      typeLabel: 'Custom',
      titleShowsOperation: false,
    })
  })
})
