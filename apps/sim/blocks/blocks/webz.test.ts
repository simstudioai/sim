import { describe, expect, it } from 'vitest'
import { WebzBlock } from '@/blocks/blocks/webz'

function transformParams(params: Record<string, unknown>) {
  const transform = WebzBlock.tools.config?.params
  if (!transform) throw new Error('Webz block params transform is missing')
  return transform(params)
}

describe('Webz filter validation keeps resolved input out of errors', () => {
  it.each(['category', 'language', 'country', 'source', 'sentiment'])(
    'rejects malformed %s JSON without exposing its contents',
    (field) => {
      expect(() => transformParams({ [field]: '[synthetic-secret-value' })).toThrowError(
        new Error(`${field} must be an array of strings`)
      )
    }
  )

  it.each([
    { field: 'category', value: '{"private":"synthetic-secret-value"}', shape: 'object' },
    { field: 'category', value: '"synthetic-secret-value"', shape: 'string' },
    { field: 'category', value: 'null', shape: 'null' },
    {
      field: 'category',
      value: '["Economy, Business and Finance", {"private":"synthetic-secret-value"}]',
      shape: 'mixed array',
    },
    {
      field: 'language',
      value: '["english", {"private":"synthetic-secret-value"}]',
      shape: 'object item',
    },
    { field: 'country', value: '["US", 123]', shape: 'number item' },
    { field: 'source', value: '[["synthetic-secret-value"]]', shape: 'nested array' },
    { field: 'sentiment', value: '["negative", null]', shape: 'null item' },
  ])('rejects $field JSON containing a $shape with a safe error', ({ field, value }) => {
    expect(() => transformParams({ [field]: value })).toThrowError(
      new Error(`${field} must be an array of strings`)
    )
  })
})
