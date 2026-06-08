/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveDocPreviewBinary } from './use-doc-preview-binary'

function buffer(byte: number): ArrayBuffer {
  return new Uint8Array([byte]).buffer
}

describe('resolveDocPreviewBinary', () => {
  it('reports empty when nothing is committed and no binary has resolved', () => {
    const result = resolveDocPreviewBinary({
      data: undefined,
      isPlaceholderData: false,
      error: null,
      lastGood: null,
      hasCommittedContent: false,
    })

    expect(result.state).toBe('empty')
    expect(result.data).toBeNull()
    expect(result.error).toBeNull()
  })

  it('reports loading when committed but the first fetch has not resolved', () => {
    const result = resolveDocPreviewBinary({
      data: undefined,
      isPlaceholderData: false,
      error: null,
      lastGood: null,
      hasCommittedContent: true,
    })

    expect(result.state).toBe('loading')
    expect(result.data).toBeNull()
  })

  it('reports ready and advances the head on a fresh success', () => {
    const fresh = buffer(1)
    const result = resolveDocPreviewBinary({
      data: fresh,
      isPlaceholderData: false,
      error: null,
      lastGood: null,
      hasCommittedContent: true,
    })

    expect(result.state).toBe('ready')
    expect(result.data).toBe(fresh)
    expect(result.lastGood).toBe(fresh)
  })

  it('holds the previous binary as stale while a new version is fetching', () => {
    const previous = buffer(1)
    const result = resolveDocPreviewBinary({
      data: previous,
      isPlaceholderData: true,
      error: null,
      lastGood: previous,
      hasCommittedContent: true,
    })

    expect(result.state).toBe('stale')
    expect(result.data).toBe(previous)
  })

  it('falls back to the last good binary and suppresses the error after a failed refetch', () => {
    const previous = buffer(1)
    const result = resolveDocPreviewBinary({
      data: undefined,
      isPlaceholderData: false,
      error: new Error('boom'),
      lastGood: previous,
      hasCommittedContent: true,
    })

    expect(result.state).toBe('stale')
    expect(result.data).toBe(previous)
    expect(result.error).toBeNull()
  })

  it('surfaces the error only when there is no binary to fall back to', () => {
    const err = new Error('missing artifact')
    const result = resolveDocPreviewBinary({
      data: undefined,
      isPlaceholderData: false,
      error: err,
      lastGood: null,
      hasCommittedContent: true,
    })

    expect(result.data).toBeNull()
    expect(result.error).toBe(err)
  })
})
