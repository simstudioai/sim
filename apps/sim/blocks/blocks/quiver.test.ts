import { describe, expect, it } from 'vitest'
import { QuiverBlock, QuiverV2Block } from '@/blocks/blocks/quiver'

describe('Quiver block versions', () => {
  it('keeps the legacy block executable and offers v2 for new blocks', () => {
    expect(QuiverBlock.hideFromToolbar).toBe(true)
    expect(QuiverBlock.sunset).toEqual({ status: 'legacy', replacedBy: 'quiver_v2' })
    expect(QuiverV2Block.name).toBe('Quiver')
    expect(QuiverV2Block.hideFromToolbar).toBe(false)
    expect(QuiverV2Block.sunset).toBeUndefined()
    expect(QuiverV2Block.subBlocks).toBe(QuiverBlock.subBlocks)
    expect(QuiverV2Block.tools.config?.params).toBe(QuiverBlock.tools.config?.params)
  })

  it.each([
    ['text_to_svg', 'quiver_text_to_svg', 'quiver_text_to_svg_v2'],
    ['image_to_svg', 'quiver_image_to_svg', 'quiver_image_to_svg_v2'],
    ['list_models', 'quiver_list_models', 'quiver_list_models'],
  ])('routes %s to the versioned response contract', (operation, legacyId, currentId) => {
    expect(QuiverBlock.tools.config?.tool({ operation })).toBe(legacyId)
    expect(QuiverV2Block.tools.config?.tool({ operation })).toBe(currentId)
    expect(QuiverBlock.tools.access).toContain(legacyId)
    expect(QuiverV2Block.tools.access).toContain(currentId)
  })

  it('defaults to SVG generation and exposes all generated files in v2', () => {
    expect(QuiverV2Block.tools.config?.tool({})).toBe('quiver_text_to_svg_v2')
    expect(QuiverV2Block.outputs.files).toMatchObject({ type: 'file[]' })
    expect(QuiverBlock.outputs.files).toMatchObject({ type: 'json' })
    expect(QuiverV2Block.outputs).not.toHaveProperty('svgContent')
    expect(QuiverBlock.outputs.svgContent).toMatchObject({ type: 'string' })
  })
})
