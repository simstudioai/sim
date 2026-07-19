/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveDocPreviewBinary, stepDocPreviewBinary } from './use-doc-preview-binary'

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

describe('stepDocPreviewBinary', () => {
  it('shows loading for a committed file whose first fetch has not resolved', () => {
    const step = stepDocPreviewBinary({
      fileChanged: false,
      data: undefined,
      isPlaceholderData: false,
      error: null,
      hasCommittedContent: true,
      prevHasResolvedForFile: false,
      prevLastGood: null,
    })

    expect(step.resolved.state).toBe('loading')
    expect(step.hasResolvedForFile).toBe(false)
    expect(step.lastGood).toBeNull()
  })

  it('advances the head and records resolution on a fresh success', () => {
    const fresh = buffer(1)
    const step = stepDocPreviewBinary({
      fileChanged: false,
      data: fresh,
      isPlaceholderData: false,
      error: null,
      hasCommittedContent: true,
      prevHasResolvedForFile: false,
      prevLastGood: null,
    })

    expect(step.resolved.state).toBe('ready')
    expect(step.resolved.data).toBe(fresh)
    expect(step.hasResolvedForFile).toBe(true)
    expect(step.lastGood).toBe(fresh)
  })

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

  it('holds the previous version as stale during a same-file recompile', () => {
    const v1 = buffer(1)
    const step = stepDocPreviewBinary({
      fileChanged: false,
      data: v1,
      isPlaceholderData: true,
      error: null,
      hasCommittedContent: true,
      prevHasResolvedForFile: true,
      prevLastGood: v1,
    })

    expect(step.resolved.state).toBe('stale')
    expect(step.resolved.data).toBe(v1)
    expect(step.hasResolvedForFile).toBe(true)
  })

  it('keeps the last good binary and suppresses the error after a failed refetch', () => {
    const v1 = buffer(1)
    const step = stepDocPreviewBinary({
      fileChanged: false,
      data: undefined,
      isPlaceholderData: false,
      error: new Error('boom'),
      hasCommittedContent: true,
      prevHasResolvedForFile: true,
      prevLastGood: v1,
    })

    expect(step.resolved.state).toBe('stale')
    expect(step.resolved.data).toBe(v1)
    expect(step.resolved.error).toBeNull()
  })
})
