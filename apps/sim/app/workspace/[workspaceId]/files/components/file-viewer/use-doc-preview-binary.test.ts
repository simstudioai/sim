import { describe, expect, it } from 'vitest'
import { resolveDocPreviewBinary, stepDocPreviewBinary } from './use-doc-preview-binary'

function buffer(byte: number): ArrayBuffer {
  return new Uint8Array([byte]).buffer
}

describe('resolveDocPreviewBinary', () => {
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

describe('stepDocPreviewBinary', () => {
  it('ignores the prior-file placeholder on a file change (no cross-file bleed)', () => {
    const priorFileBytes = buffer(1)
    const step = stepDocPreviewBinary({
      fileChanged: true,
      data: priorFileBytes,
      isPlaceholderData: true,
      error: null,
      hasCommittedContent: true,
      prevHasResolvedForFile: true,
      prevLastGood: priorFileBytes,
    })

    expect(step.resolved.state).toBe('loading')
    expect(step.resolved.data).toBeNull()
    expect(step.hasResolvedForFile).toBe(false)
    expect(step.lastGood).toBeNull()
  })
})
