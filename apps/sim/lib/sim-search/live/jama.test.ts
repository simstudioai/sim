import { describe, expect, it } from 'vitest'
import { readJama } from '@/lib/sim-search/live/jama'
import type { NativeClient } from '@/lib/sim-search/live/types'

/** A malformed provider item must not become a successful blank document under a valid reference. */
describe('Jama live item boundary', () => {
  it.each([
    { name: 'null', value: null },
    { name: 'array', value: [] },
    { name: 'missing', value: undefined },
  ])('rejects malformed item fields $name', async ({ value: fields }) => {
    const api: NativeClient = {
      json: async () => ({
        data: { id: 101, project: 7, documentKey: 'REQ-101', fields },
      }),
      text: async () => {
        throw new Error('Unexpected text request')
      },
      bytes: async () => {
        throw new Error('Unexpected binary request')
      },
    }
    await expect(
      readJama(api, { id: '101', container: '7' }, 'https://example.jamacloud.com')
    ).rejects.toThrow('no longer available')
  })
})
