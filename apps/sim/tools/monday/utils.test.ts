import { describe, expect, it } from 'vitest'
import { toGraphqlJsonArg } from '@/tools/monday/utils'

describe('toGraphqlJsonArg', () => {
  const columnValues = { status: { label: 'Done' } }

  it('renders an object as a JSON string literal for the GraphQL JSON scalar', () => {
    expect(toGraphqlJsonArg(columnValues)).toBe(JSON.stringify(JSON.stringify(columnValues)))
  })

  it('renders a JSON string exactly as before', () => {
    const json = JSON.stringify(columnValues)
    expect(toGraphqlJsonArg(json)).toBe(JSON.stringify(json))
  })
})
