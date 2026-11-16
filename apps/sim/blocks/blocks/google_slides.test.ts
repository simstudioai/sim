import { describe, expect, it } from 'vitest'
import { GoogleSlidesBlock, GoogleSlidesV2Block } from '@/blocks/blocks/google_slides'
import type { BlockConfig, BlockToolParamsContext } from '@/blocks/types'

function mapParams(
  block: BlockConfig,
  params: Record<string, unknown>,
  context?: BlockToolParamsContext
) {
  const mapper = block.tools.config?.params
  if (!mapper) throw new Error(`${block.type} has no params mapper`)
  return mapper(params, context)
}

describe('Google Slides agent tool calls', () => {
  it('forwards the model slide index for write', () => {
    const mapped = mapParams(
      GoogleSlidesV2Block,
      { presentationId: 'p1', content: 'Hello', slideIndex: 2 },
      { operation: 'write' }
    )
    expect(mapped.slideIndex).toBe(2)
  })

  it('forwards the model folder for create and copy', () => {
    expect(
      mapParams(GoogleSlidesV2Block, { title: 'Deck', folderId: 'f1' }, { operation: 'create' })
        .folderId
    ).toBe('f1')
    expect(
      mapParams(
        GoogleSlidesV2Block,
        { sourcePresentationId: 'src', title: 'Copy', folderId: 'f2' },
        { operation: 'copy_presentation' }
      ).folderId
    ).toBe('f2')
  })

  it('keeps the model object id instead of the empty block field', () => {
    const mapped = mapParams(
      GoogleSlidesV2Block,
      { presentationId: 'p1', objectId: 'shape_1' },
      { operation: 'delete_object' }
    )
    expect(mapped.objectId).toBe('shape_1')
  })

  it('keeps the model z-order enum in the tool operation param', () => {
    const mapped = mapParams(
      GoogleSlidesV2Block,
      { presentationId: 'p1', objectIds: 'a,b', operation: 'SEND_TO_BACK' },
      { operation: 'update_page_elements_z_order' }
    )
    expect(mapped.operation).toBe('SEND_TO_BACK')
  })

  it('accepts a model image URL for add_image without an uploaded file', () => {
    const mapped = mapParams(
      GoogleSlidesV2Block,
      { presentationId: 'p1', pageObjectId: 's1', imageUrl: 'https://example.com/a.png' },
      { operation: 'add_image' }
    )
    expect(mapped.imageUrl).toBe('https://example.com/a.png')
  })
})

describe('Google Slides canvas', () => {
  it('never sends the block operation name as the z-order enum', () => {
    const mapped = mapParams(GoogleSlidesV2Block, {
      operation: 'update_page_elements_z_order',
      presentationId: 'p1',
      zOrderObjectIds: 'a',
    })
    expect(mapped.operation).toBeUndefined()
  })

  it('sends the legacy image source as the image URL', () => {
    const mapped = mapParams(GoogleSlidesBlock, {
      operation: 'add_image',
      presentationId: 'p1',
      pageObjectId: 's1',
      imageSource: 'https://example.com/a.png',
    })
    expect(mapped.imageUrl).toBe('https://example.com/a.png')
  })

  it('extracts the URL from a referenced file serialized into the legacy image source', () => {
    const mapped = mapParams(GoogleSlidesBlock, {
      operation: 'add_image',
      presentationId: 'p1',
      pageObjectId: 's1',
      imageSource: JSON.stringify({ name: 'a.png', url: 'https://files.example.com/a.png' }),
    })
    expect(mapped.imageUrl).toBe('https://files.example.com/a.png')
  })
})
