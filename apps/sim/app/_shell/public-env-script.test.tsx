/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PublicEnvScript } from '@/app/_shell/public-env-script'

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
