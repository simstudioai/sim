/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { searchTool } from '@/tools/serply/search'

describe('serply searchTool', () => {
  it('sends the api key, accept header, and an explicit user agent', () => {
    const headers = searchTool.request.headers({ query: 'sim', apiKey: 'test-key' })

    expect(headers['X-Api-Key']).toBe('test-key')
    expect(headers.Accept).toBe('application/json')
    expect(headers['User-Agent']).toBeTruthy()
  })

  it('builds the query URL with the optional num param', () => {
    const url = (searchTool.request.url as (params: any) => string)({
      query: 'sim workflows',
      apiKey: 'test-key',
      num: 20,
    })

    expect(url).toBe('https://api.serply.io/v1/search/?q=sim+workflows&num=20')
  })

  it('maps organic results into searchResults', async () => {
    const response = new Response(
      JSON.stringify({
        results: [
          { title: 'Sim', link: 'https://sim.ai', description: 'AI workspace' },
          { title: 'No link', description: 'dropped upstream? kept here' },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.success).toBe(true)
    expect(result.output.searchResults).toEqual([
      { title: 'Sim', link: 'https://sim.ai', snippet: 'AI workspace' },
      { title: 'No link', link: '', snippet: 'dropped upstream? kept here' },
    ])
  })

  it('returns an empty array when the response has no results', async () => {
    const response = new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.output.searchResults).toEqual([])
  })
})
