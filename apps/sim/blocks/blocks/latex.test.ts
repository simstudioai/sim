import { describe, expect, it } from 'vitest'
import { LatexBlock } from '@/blocks/blocks/latex'

const mapParams = LatexBlock.tools.config?.params
if (!mapParams) throw new Error('LatexBlock has no params mapper')

describe('LatexBlock agent tool calls', () => {
  it('forwards a search query typed into the tool row, which carries no operation in its params', () => {
    expect(
      mapParams({ packageQuery: 'chemistry' }, { operation: 'latex_search_packages' })
    ).toEqual({ query: 'chemistry' })
  })

  it('keeps the model query and name when the tool row leaves the block fields blank', () => {
    expect(
      mapParams({ packageQuery: '', query: 'tikz' }, { operation: 'latex_search_packages' })
    ).toEqual({ query: 'tikz' })
    expect(mapParams({ name: ' amsmath ' }, { operation: 'latex_get_package' })).toEqual({
      name: 'amsmath',
    })
  })
})
