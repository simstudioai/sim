import { describe, expect, it } from 'vitest'
import { contextDevExtractTool } from '@/tools/context_dev/extract'
import { contextDevGetBrandTool } from '@/tools/context_dev/get_brand'
import { timeoutOpts } from '@/tools/context_dev/utils'

/**
 * Context.dev replaced `timeoutMS` with `timeoutOpts.milliseconds`; its extract and search bodies
 * reject unknown fields, so the old key failed the request.
 */
describe('Context.dev request timeout', () => {
  it('sends the timeout as timeoutOpts in a JSON body', () => {
    const body = contextDevExtractTool.request.body?.({
      apiKey: 'key',
      url: 'https://example.com',
      schema: { type: 'object' },
      timeoutMS: 30000,
    })

    expect(body).toMatchObject({ timeoutOpts: { milliseconds: 30000 } })
    expect(body).not.toHaveProperty('timeoutMS')
  })

  it.each([[''], [null]])('sends no timeout for an untouched field (%j)', (value) => {
    expect(timeoutOpts(value)).toBeUndefined()
  })

  it('sends the timeout as a timeoutOpts deep-object query parameter', () => {
    const url = contextDevGetBrandTool.request.url
    const href =
      typeof url === 'function'
        ? url({ apiKey: 'key', domain: 'example.com', timeoutMS: 30000 })
        : url
    const search = new URL(href).searchParams

    expect(search.get('timeoutOpts[milliseconds]')).toBe('30000')
    expect(search.has('timeoutMS')).toBe(false)
  })
})
