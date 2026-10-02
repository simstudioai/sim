import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { partialToolRegistry } from '@sim/testing/mocks/tool-registry.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { LinkupBlock } from '@/blocks/blocks/linkup'
import { executeTool } from '@/tools/index'
import * as linkupTools from '@/tools/linkup'
import { fetchTool } from '@/tools/linkup/fetch'
import type { LinkupFetchRequestBody } from '@/tools/linkup/types'
import { tools } from '@/tools/registry'

/** Registers only Linkup's configs in the global registry mock; the full one is ~6,000 modules. */
Object.assign(tools, partialToolRegistry(linkupTools))

const API_KEY = 'test-key'

function fetchBody(params: Record<string, unknown>): LinkupFetchRequestBody {
  const body = fetchTool.request.body?.({
    url: 'https://example.com',
    apiKey: API_KEY,
    ...params,
  } as never)
  return body as LinkupFetchRequestBody
}

function fetchCost(params: Record<string, unknown>) {
  const pricing = fetchTool.hosting?.pricing
  if (pricing?.type !== 'custom') throw new Error('expected custom pricing')
  return pricing.getCost(params as never, {} as never)
}

/** Answers the executor's pinned-IP request with {@link payload} and records the call. */
function mockLinkupResponse(payload: Record<string, unknown>) {
  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValueOnce({
    isValid: true,
    resolvedIP: '93.184.216.34',
  })
  inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce({
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: {
      get: (name: string) => response.headers.get(name),
      toRecord: () => Object.fromEntries(response.headers.entries()),
    },
    body: response.body,
    text: () => response.text(),
    json: () => response.json(),
    arrayBuffer: () => response.arrayBuffer(),
  })
}

function sentRequest(): { url: string; body: LinkupFetchRequestBody } {
  const [url, , options] = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0]
  return { url, body: JSON.parse(options.body) }
}

describe('linkup_fetch request body', () => {
  it('sends renderJs as false when it was not set', () => {
    expect(fetchBody({})).toEqual({ url: 'https://example.com', renderJs: false })
  })

  it('trims whitespace pasted around the url', () => {
    expect(fetchBody({ url: '  https://example.com/page  ' }).url).toBe('https://example.com/page')
  })

  it('forwards boolean options, including explicit false values', () => {
    expect(fetchBody({ renderJs: true, includeRawHtml: false, extractImages: true })).toEqual({
      url: 'https://example.com',
      renderJs: true,
      includeRawHtml: false,
      extractImages: true,
    })
  })

  it.each([
    ['true', true],
    ['TRUE', true],
    [' True ', true],
    ['false', false],
    ['', false],
  ])('sends the string switch %j as the boolean %s', (value, expected) => {
    const body = fetchBody({ renderJs: value, includeRawHtml: value, extractImages: value })
    expect(body.renderJs).toBe(expected)
    expect(body.includeRawHtml).toBe(expected)
    expect(body.extractImages).toBe(expected)
  })
})

describe('linkup_fetch hosted pricing', () => {
  it.each([
    [undefined, 0.001],
    [false, 0.001],
    ['false', 0.001],
    [true, 0.005],
    ['true', 0.005],
    ['TRUE', 0.005],
  ])('charges renderJs=%j at $%s', (renderJs, cost) => {
    expect(fetchCost({ renderJs })).toMatchObject({ cost })
  })

  it('bills the same rendering decision the request sends', () => {
    const params = { renderJs: 'True' }
    expect(fetchBody(params).renderJs).toBe(true)
    expect(fetchCost(params)).toMatchObject({ cost: 0.005, metadata: { renderJs: true } })
  })
})

describe('linkup_fetch transformResponse', () => {
  it('defaults optional fields when they are absent', async () => {
    const result = await fetchTool.transformResponse?.(
      new Response(JSON.stringify({ markdown: 'text' }))
    )
    expect(result?.output).toEqual({ markdown: 'text', rawHtml: null, images: [], favicon: null })
  })
})

describe('linkup_fetch execution', () => {
  it('runs a saved Fetch block through the executor with a string render switch', async () => {
    mockLinkupResponse({
      markdown: '# Example',
      rawHtml: '<h1>Example</h1>',
      images: [{ alt: 'Logo', url: 'https://example.com/logo.png' }],
      favicon: 'https://favicons.linkup.so?domain=example.com',
    })
    const blockInputs = {
      operation: 'linkup_fetch',
      apiKey: API_KEY,
      url: 'https://example.com',
      renderJs: 'true',
      includeRawHtml: 'true',
    }
    const toolId = LinkupBlock.tools.config?.tool?.(blockInputs as never)
    expect(toolId).toBe('linkup_fetch')

    const result = await executeTool(toolId as string, blockInputs)

    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      markdown: '# Example',
      rawHtml: '<h1>Example</h1>',
      images: [{ alt: 'Logo', url: 'https://example.com/logo.png' }],
      favicon: 'https://favicons.linkup.so?domain=example.com',
    })
    const sent = sentRequest()
    expect(sent.url).toBe('https://api.linkup.so/v1/fetch')
    expect(sent.body).toEqual({
      url: 'https://example.com',
      renderJs: true,
      includeRawHtml: true,
    })
  })
})

describe('linkup block', () => {
  const selectTool = (params: Record<string, unknown>) =>
    LinkupBlock.tools.config?.tool?.(params as never)

  it('routes blocks saved before the operation dropdown to search', () => {
    expect(selectTool({ q: 'latest news' })).toBe('linkup_search')
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
