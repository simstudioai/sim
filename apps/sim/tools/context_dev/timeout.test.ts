import { describe, expect, it } from 'vitest'
import { contextDevExtractTool } from '@/tools/context_dev/extract'
import { contextDevGetBrandTool } from '@/tools/context_dev/get_brand'
import type { ContextDevExtractParams } from '@/tools/context_dev/types'

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

  it.each([[''], [null]])('omits the timeout when the field is untouched (%j)', (timeoutMS) => {
    const params: Record<string, unknown> = {
      apiKey: 'key',
      url: 'https://example.com',
      schema: { type: 'object' },
      timeoutMS,
    }
    const body = contextDevExtractTool.request.body?.(params as ContextDevExtractParams)

    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('timeoutOpts')
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
