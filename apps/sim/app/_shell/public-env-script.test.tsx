/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PUBLIC_ENV_ATTRIBUTE } from '@/lib/core/config/env'
import { PublicEnvScript, publicEnvHtmlAttributes } from '@/app/_shell/public-env-script'

vi.unmock('@/lib/core/config/env')

/**
 * Guards the one property that matters: the emitted tag assigns `window.__ENV`
 * itself. Next's `beforeInteractive` strategy instead pushes the assignment onto
 * `self.__next_s`, a queue `appBootstrap` reads exactly once and abandons when it
 * is empty - so whenever the bootstrap chunk runs before the parser reaches this
 * tag, the assignment is discarded and `window.__ENV` is never defined for that
 * document. See the component's TSDoc for the full ordering argument.
 */
describe('PublicEnvScript', () => {
  it('emits a script that assigns window.__ENV directly', () => {
    const markup = renderToStaticMarkup(<PublicEnvScript />)

    expect(markup).toContain("window['__ENV'] =")
  })

  it('does not defer the assignment into the __next_s queue', () => {
    const markup = renderToStaticMarkup(<PublicEnvScript />)

    expect(markup).not.toContain('__next_s')
  })

  it('passes only NEXT_PUBLIC_ variables through to the browser', () => {
    const keys = Object.keys(PublicEnvScript().props.env)

    expect(keys.every((key) => /^NEXT_PUBLIC_/i.test(key))).toBe(true)
  })
})

/**
 * The script above is rendered from the component tree, so it lands at the end
 * of `<head>` - after the bootstrap chunks that can already be executing. These
 * attributes go on `<html>`, the document's first tag, which is what makes the
 * same values readable by code that runs in that gap.
 */
describe('publicEnvHtmlAttributes', () => {
  it('carries the public env under the attribute getEnv reads', () => {
    const attributes = publicEnvHtmlAttributes()

    expect(Object.keys(attributes)).toEqual([PUBLIC_ENV_ATTRIBUTE])
    expect(() => JSON.parse(attributes[PUBLIC_ENV_ATTRIBUTE])).not.toThrow()
  })

  it('exposes only NEXT_PUBLIC_ variables', () => {
    const values = JSON.parse(publicEnvHtmlAttributes()[PUBLIC_ENV_ATTRIBUTE])

    expect(Object.keys(values).every((key) => /^NEXT_PUBLIC_/i.test(key))).toBe(true)
  })

  /**
   * Two transports for one snapshot only stays safe while they agree; a reader
   * that resolved different values depending on which one it happened to hit
   * would be worse than the race this replaces.
   */
  it('carries exactly what the script assigns', () => {
    const values = JSON.parse(publicEnvHtmlAttributes()[PUBLIC_ENV_ATTRIBUTE])

    expect(values).toEqual(PublicEnvScript().props.env)
  })
})
