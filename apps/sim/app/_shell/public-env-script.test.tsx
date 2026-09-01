/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PUBLIC_ENV_ATTRIBUTE } from '@/lib/core/config/env'
import {
  PublicEnvScript,
  publicEnvHtmlAttributes,
  RuntimePublicEnvScript,
  serializePublicEnv,
} from '@/app/_shell/public-env-script'

vi.unmock('@/lib/core/config/env')

const { mockConnection } = vi.hoisted(() => ({ mockConnection: vi.fn() }))

vi.mock('next/server', () => ({ connection: mockConnection }))

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

  it('cannot be terminated by a script-like public value', () => {
    const serialized = serializePublicEnv({
      NEXT_PUBLIC_SCRIPT_ESCAPE_TEST: '</script><script>window.pwned=true</script>',
    })

    expect(serialized).not.toContain('</script>')
    expect(serialized).toContain('\\u003c/script>')
  })

  it('passes only NEXT_PUBLIC_ variables through to the browser', () => {
    const keys = Object.keys(PublicEnvScript().props.env)

    expect(keys.every((key) => /^NEXT_PUBLIC_/i.test(key))).toBe(true)
  })

  it('reads self-hosted values at request time after opting into dynamic rendering', async () => {
    const previous = process.env.NEXT_PUBLIC_RUNTIME_ENV_TEST
    process.env.NEXT_PUBLIC_RUNTIME_ENV_TEST = 'runtime-value'

    try {
      const script = await RuntimePublicEnvScript()
      expect(mockConnection).toHaveBeenCalledOnce()
      expect(script.props.env.NEXT_PUBLIC_RUNTIME_ENV_TEST).toBe('runtime-value')
    } finally {
      if (previous === undefined)
        Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_RUNTIME_ENV_TEST')
      else process.env.NEXT_PUBLIC_RUNTIME_ENV_TEST = previous
    }
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
