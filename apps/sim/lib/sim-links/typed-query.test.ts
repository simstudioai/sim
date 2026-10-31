import { describe, expect, it } from 'vitest'
import { typedQuery } from '@/lib/sim-links/typed-query'

describe('typedQuery', () => {
  it.each([
    ['', ''],
    ['?', ''],
    ['?q=&flag', 'q=&flag'],
    ['?a=hello%20world&a=b+c', 'a=hello%20world&a=b+c'],
    ['?_rsc=abc&q=1', 'q=1'],
    ['?q=1&_rsc', 'q=1'],
    ['?_rscx=1', '_rscx=1'],
  ])('keeps %j as typed, apart from Next’s own marker', (search, query) => {
    expect(typedQuery(search)).toBe(query)
  })
})
