import { describe, expect, it } from 'vitest'
import { UserFailure } from '@/lib/core/errors/user-failure'
import { higgsfieldGenerateTool } from '@/tools/higgsfield/generate'

describe('higgsfield_generate request', () => {
  it('asks for a credential instead of crashing when none was resolved', () => {
    const params = { model: 'higgsfield-ai/soul/standard', input: '{}' } as never
    expect(() => higgsfieldGenerateTool.request.url(params)).toThrow(UserFailure)
    expect(() => higgsfieldGenerateTool.request.url(params)).toThrow(/Higgsfield credential/)
  })
})
