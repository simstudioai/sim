import { describe, expect, it } from 'vitest'
import { BROWSER_SESSION_RESOURCE_ID, isEphemeralResource } from './types'

describe('isEphemeralResource', () => {
  it('persists browser tab metadata with the chat', () => {
    expect(
      isEphemeralResource({
        type: 'browser',
        id: BROWSER_SESSION_RESOURCE_ID,
        title: 'Browser',
      })
    ).toBe(false)
  })

  it('keeps synthetic panels client-only', () => {
    expect(isEphemeralResource({ type: 'generic', id: 'results', title: 'Results' })).toBe(true)
    expect(
      isEphemeralResource({ type: 'file', id: 'streaming-file', title: 'Streaming file' })
    ).toBe(true)
  })
})
