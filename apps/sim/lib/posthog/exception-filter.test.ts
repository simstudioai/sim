/**
 * @vitest-environment node
 */
import type { CaptureResult } from 'posthog-js'
import { describe, expect, it } from 'vitest'
import { dropUnactionableExceptions } from '@/lib/posthog/exception-filter'

function exceptionEvent(...exceptions: Array<{ type?: string; value?: string }>): CaptureResult {
  return {
    uuid: 'test-uuid',
    event: '$exception',
    properties: { $exception_list: exceptions },
  } as CaptureResult
}

describe('dropUnactionableExceptions', () => {
  it('passes through events that are not exceptions', () => {
    const event = {
      uuid: 'test-uuid',
      event: 'block_added',
      properties: { block_type: 'agent' },
    } as CaptureResult

    expect(dropUnactionableExceptions(event)).toBe(event)
  })

  it('passes through a null event from an earlier hook', () => {
    expect(dropUnactionableExceptions(null)).toBeNull()
  })

  it.each([
    'ResizeObserver loop completed with undelivered notifications.',
    'ResizeObserver loop completed with undelivered notifications',
    'ResizeObserver loop limit exceeded',
    'Script error.',
  ])('drops the undiagnosable browser artifact %j', (value) => {
    expect(dropUnactionableExceptions(exceptionEvent({ type: 'Error', value }))).toBeNull()
  })

  it.each(['AbortError', 'Canceled'])('drops the cancellation signal %j', (type) => {
    expect(dropUnactionableExceptions(exceptionEvent({ type, value: 'whatever' }))).toBeNull()
  })

  it('keeps a real exception', () => {
    const event = exceptionEvent({
      type: 'TypeError',
      value: "Cannot read properties of undefined (reading 'id')",
    })

    expect(dropUnactionableExceptions(event)).toBe(event)
  })

  it('keeps a chained exception when only one link is noise', () => {
    const event = exceptionEvent(
      { type: 'AbortError', value: 'signal is aborted without reason' },
      { type: 'RangeError', value: 'Maximum call stack size exceeded.' }
    )

    expect(dropUnactionableExceptions(event)).toBe(event)
  })

  it('keeps an exception whose message merely mentions a filtered one', () => {
    const event = exceptionEvent({
      type: 'TypeError',
      value: 'Failed to patch ResizeObserver loop completed with undelivered notifications',
    })

    expect(dropUnactionableExceptions(event)).toBe(event)
  })

  it.each([
    ['a missing list', undefined],
    ['an empty list', []],
    ['a non-array list', 'not-an-array'],
    ['unrecognizable entries', [null, 'string-entry']],
  ])('fails open on %s', (_label, $exception_list) => {
    const event = {
      uuid: 'test-uuid',
      event: '$exception',
      properties: { $exception_list },
    } as CaptureResult

    expect(dropUnactionableExceptions(event)).toBe(event)
  })
})
