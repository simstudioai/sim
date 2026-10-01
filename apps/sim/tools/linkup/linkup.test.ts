import { describe, expect, it } from 'vitest'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { LinkupBlock } from '@/blocks/blocks/linkup'
import { fetchTool } from '@/tools/linkup/fetch'

const API_KEY = 'test-key'

function fetchBody(params: Record<string, unknown>) {
  return fetchTool.request.body?.({
    url: 'https://example.com',
    apiKey: API_KEY,
    ...params,
  } as never) as Record<string, any>
}

describe('linkup_fetch request body', () => {
  it('sends only the url when no options were set', () => {
    expect(fetchBody({})).toEqual({ url: 'https://example.com' })
  })

  it('trims whitespace pasted around the url', () => {
    expect(fetchBody({ url: '  https://example.com/page  ' }).url).toBe('https://example.com/page')
  })

  it('forwards the fetch options, including explicit false values', () => {
    expect(fetchBody({ renderJs: true, includeRawHtml: false, extractImages: true })).toEqual({
      url: 'https://example.com',
      renderJs: true,
      includeRawHtml: false,
      extractImages: true,
    })
  })
})

describe('linkup_fetch transformResponse', () => {
  it('maps the fetch payload onto the tool output', async () => {
    const response = new Response(
      JSON.stringify({
        markdown: '# Example',
        rawHtml: '<h1>Example</h1>',
        images: [{ alt: 'Logo', url: 'https://example.com/logo.png' }],
        favicon: 'https://favicons.linkup.so?domain=example.com',
      })
    )
    const result = await fetchTool.transformResponse?.(response)
    expect(result?.output).toEqual({
      markdown: '# Example',
      rawHtml: '<h1>Example</h1>',
      images: [{ alt: 'Logo', url: 'https://example.com/logo.png' }],
      favicon: 'https://favicons.linkup.so?domain=example.com',
    })
  })

  it('defaults optional fields when they are absent', async () => {
    const result = await fetchTool.transformResponse?.(
      new Response(JSON.stringify({ markdown: 'text' }))
    )
    expect(result?.output).toEqual({ markdown: 'text', rawHtml: null, images: [], favicon: null })
  })
})

describe('linkup_fetch hosted pricing', () => {
  const getCost = (params: Record<string, unknown>) => {
    const pricing = fetchTool.hosting?.pricing
    if (pricing?.type !== 'custom') throw new Error('expected custom pricing')
    return pricing.getCost(params as never, {} as never)
  }

  it('charges the standard rate without JavaScript rendering', () => {
    expect(getCost({})).toMatchObject({ cost: 0.001 })
  })

  it('charges the rendered rate when renderJs is enabled', () => {
    expect(getCost({ renderJs: true })).toMatchObject({ cost: 0.005 })
  })
})

describe('linkup block', () => {
  const selectTool = (params: Record<string, unknown>) =>
    LinkupBlock.tools.config?.tool?.(params as never)

  it('routes blocks saved before the operation dropdown to search', () => {
    expect(selectTool({ q: 'latest news' })).toBe('linkup_search')
  })

  it('routes each operation to its tool', () => {
    expect(selectTool({ operation: 'linkup_search' })).toBe('linkup_search')
    expect(selectTool({ operation: 'linkup_fetch' })).toBe('linkup_fetch')
  })

  it('keeps search fields visible when no operation is stored', () => {
    const query = LinkupBlock.subBlocks.find((subBlock) => subBlock.id === 'q')
    const url = LinkupBlock.subBlocks.find((subBlock) => subBlock.id === 'url')
    expect(evaluateSubBlockCondition(query?.condition, {})).toBe(true)
    expect(evaluateSubBlockCondition(url?.condition, {})).toBe(false)
  })

  it('shows only fetch fields for the fetch operation', () => {
    const values = { operation: 'linkup_fetch' }
    const query = LinkupBlock.subBlocks.find((subBlock) => subBlock.id === 'q')
    const url = LinkupBlock.subBlocks.find((subBlock) => subBlock.id === 'url')
    expect(evaluateSubBlockCondition(query?.condition, values)).toBe(false)
    expect(evaluateSubBlockCondition(url?.condition, values)).toBe(true)
  })
})
