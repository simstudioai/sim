/**
 * @vitest-environment node
 */
import type { CaptureResult } from 'posthog-js'
import { describe, expect, it } from 'vitest'
import { dropUnactionableExceptions, preparePostHogEvent } from '@/lib/posthog/exception-filter'

interface TestException {
  type?: string
  value?: string
  mechanism?: { handled?: boolean }
}

/** Mirrors what PostHog's `window.onerror` / `unhandledrejection` wrappers build. */
function browserRaised(...exceptions: TestException[]): CaptureResult {
  const [head, ...rest] = exceptions
  return {
    uuid: 'test-uuid',
    event: '$exception',
    properties: {
      $exception_list: [
        { ...head, mechanism: { handled: false } },
        // PostHog forces chained cause links to handled: true regardless of the source.
        ...rest.map((exception) => ({ ...exception, mechanism: { handled: true } })),
      ],
    },
  } as CaptureResult
}

/** Mirrors what `posthog.captureException` builds — a deliberate report. */
function deliberatelyReported(exception: TestException): CaptureResult {
  return {
    uuid: 'test-uuid',
    event: '$exception',
    properties: { $exception_list: [{ ...exception, mechanism: { handled: true } }] },
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
    expect(dropUnactionableExceptions(browserRaised({ type: 'Error', value }))).toBeNull()
  })

  it('drops a cancellation whose name is the coerced type', () => {
    expect(
      dropUnactionableExceptions(browserRaised({ type: 'Canceled', value: 'Canceled' }))
    ).toBeNull()
  })

  /**
   * The shape a real aborted `fetch` produces: PostHog's DOMException coercer
   * reports type `DOMException` and folds the name into the value, so a filter
   * that only tested `type` would let every one of these through.
   */
  it('drops a cancellation whose name is folded into a DOMException value', () => {
    expect(
      dropUnactionableExceptions(
        browserRaised({
          type: 'DOMException',
          value: 'AbortError: signal is aborted without reason',
        })
      )
    ).toBeNull()
  })

  it('keeps a DOMException that is not a cancellation', () => {
    const event = browserRaised({
      type: 'DOMException',
      value: "NotFoundError: Failed to execute 'removeChild' on 'Node'",
    })

    expect(dropUnactionableExceptions(event)).toBe(event)
  })

  it('keeps a real exception', () => {
    const event = browserRaised({
      type: 'TypeError',
      value: "Cannot read properties of undefined (reading 'id')",
    })

    expect(dropUnactionableExceptions(event)).toBe(event)
  })

  it('keeps a deliberately reported exception even when it looks like noise', () => {
    const event = deliberatelyReported({
      type: 'AbortError',
      value: 'signal is aborted without reason',
    })

    expect(dropUnactionableExceptions(event)).toBe(event)
  })

  it('keeps a chained exception when only one link is noise', () => {
    const event = browserRaised(
      { type: 'AbortError', value: 'signal is aborted without reason' },
      { type: 'RangeError', value: 'Maximum call stack size exceeded.' }
    )

    expect(dropUnactionableExceptions(event)).toBe(event)
  })

  it('keeps an exception whose message merely mentions a filtered one', () => {
    const event = browserRaised({
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

describe('preparePostHogEvent', () => {
  it('strips query strings and fragments from automatically captured URL properties', () => {
    const event = {
      uuid: 'test-uuid',
      event: 'signup_page_viewed',
      properties: {
        $current_url: 'https://sim.ai/signup?email=private%40example.com#form',
        $referrer: 'https://sim.ai/invite?token=secret',
        $pathname: '/signup',
      },
    } as CaptureResult

    expect(preparePostHogEvent(event)).toEqual({
      ...event,
      properties: {
        $current_url: 'https://sim.ai/signup',
        $referrer: 'https://sim.ai/invite',
        $pathname: '/signup',
      },
    })
    expect(event.properties?.$current_url).toContain('?email=')
  })

  it('still drops an unactionable exception after URL sanitization', () => {
    const event = browserRaised({
      type: 'DOMException',
      value: 'AbortError: signal is aborted without reason',
    })
    event.properties.$current_url = 'https://sim.ai/workspace/id?token=secret'

    expect(preparePostHogEvent(event)).toBeNull()
  })
})
