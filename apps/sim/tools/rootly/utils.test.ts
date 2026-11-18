import { describe, expect, it } from 'vitest'
import { rootlyErrorMessage } from '@/tools/rootly/utils'

const response = new Response(null, { status: 422, statusText: 'Unprocessable Entity' })

describe('rootlyErrorMessage', () => {
  it('keeps the specific detail next to a generic title', () => {
    const errorData = { errors: [{ title: 'Unprocessable Entity', detail: 'Title is too long' }] }
    expect(rootlyErrorMessage(errorData, response)).toBe('Unprocessable Entity: Title is too long')
  })

  it('uses the title when Rootly sends no detail', () => {
    expect(rootlyErrorMessage({ errors: [{ title: 'Invalid token' }] }, response)).toBe(
      'Invalid token'
    )
  })

  it('falls back to the HTTP status for a body without errors', () => {
    expect(rootlyErrorMessage({}, response)).toBe('HTTP 422: Unprocessable Entity')
  })
})
