/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getEnv, PUBLIC_ENV_ATTRIBUTE } from '@/lib/core/config/env'

vi.unmock('@/lib/core/config/env')

/**
 * A key no deployment defines, so these assertions describe the resolution order
 * itself rather than whatever `process.env` happens to hold. `getEnv`'s last
 * fallback is `process.env`, which is populated in a Node test run but all but
 * empty in the browser bundle - reusing a real key here would pass or fail on
 * whether a local `.env` is present.
 */
const TEST_KEY = 'NEXT_PUBLIC_SIM_ENV_RESOLUTION_FIXTURE'

/**
 * Covers the browser resolution order for `NEXT_PUBLIC_*`.
 *
 * The `<html>` attribute exists because `window.__ENV` is assigned by a script
 * ~13KB into the document while Next's bootstrap chunks sit in the preamble and
 * `appBootstrap` hydrates synchronously once `self.__next_s` is empty. Client
 * code can therefore read env before that assignment lands; the attribute is
 * parsed before any script can run, so it always has.
 */
describe('getEnv', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(PUBLIC_ENV_ATTRIBUTE)
    window.__ENV = undefined as unknown as typeof window.__ENV
  })

  it('resolves from the <html> attribute while window.__ENV is still unassigned', () => {
    document.documentElement.setAttribute(
      PUBLIC_ENV_ATTRIBUTE,
      JSON.stringify({ [TEST_KEY]: 'https://attribute.example' })
    )

    expect(window.__ENV).toBeUndefined()
    expect(getEnv(TEST_KEY)).toBe('https://attribute.example')
  })

  it('prefers window.__ENV once assigned, so a runtime override still wins', () => {
    document.documentElement.setAttribute(
      PUBLIC_ENV_ATTRIBUTE,
      JSON.stringify({ [TEST_KEY]: 'https://attribute.example' })
    )
    window.__ENV = { [TEST_KEY]: 'https://global.example' }

    expect(getEnv(TEST_KEY)).toBe('https://global.example')
  })

  it('falls through to the attribute for keys window.__ENV does not carry', () => {
    document.documentElement.setAttribute(
      PUBLIC_ENV_ATTRIBUTE,
      JSON.stringify({ [TEST_KEY]: 'https://attribute.example' })
    )
    window.__ENV = { NEXT_PUBLIC_SOMETHING_ELSE: 'https://global.example' }

    expect(getEnv(TEST_KEY)).toBe('https://attribute.example')
  })

  it('re-reads when the attribute changes rather than serving a stale parse', () => {
    document.documentElement.setAttribute(
      PUBLIC_ENV_ATTRIBUTE,
      JSON.stringify({ [TEST_KEY]: 'https://first.example' })
    )
    expect(getEnv(TEST_KEY)).toBe('https://first.example')

    document.documentElement.setAttribute(
      PUBLIC_ENV_ATTRIBUTE,
      JSON.stringify({ [TEST_KEY]: 'https://second.example' })
    )
    expect(getEnv(TEST_KEY)).toBe('https://second.example')
  })

  it('treats a malformed attribute as absent instead of throwing', () => {
    document.documentElement.setAttribute(PUBLIC_ENV_ATTRIBUTE, '{not json')

    expect(() => getEnv(TEST_KEY)).not.toThrow()
    expect(getEnv(TEST_KEY)).toBeUndefined()
  })

  it('returns undefined when no source carries the key', () => {
    expect(getEnv(TEST_KEY)).toBeUndefined()
  })
})
