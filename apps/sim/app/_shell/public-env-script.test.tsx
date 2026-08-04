/**
 * @vitest-environment node
 */
import { EnvScript } from 'next-runtime-env'
import { describe, expect, it } from 'vitest'
import { PublicEnvScript } from '@/app/_shell/public-env-script'

/**
 * Guards the loading strategy, not the markup. A plain `<script>` rendered from
 * the root layout lands after the `<script async>` chunk tags Next emits at the
 * top of the document, so a chunk can execute - and hydration can begin - before
 * `window.__ENV` is populated. Delegating to `<EnvScript>` keeps the
 * `beforeInteractive` guarantee that `next-runtime-env` applies by default.
 */
describe('PublicEnvScript', () => {
  it('delegates to next-runtime-env EnvScript rather than emitting a raw script tag', () => {
    const element = PublicEnvScript()

    expect(element.type).toBe(EnvScript)
    expect(element.type).not.toBe('script')
  })

  it('does not opt out of the beforeInteractive strategy', () => {
    const { disableNextScript, nextScriptProps } = PublicEnvScript().props

    expect(disableNextScript).toBeUndefined()
    expect(nextScriptProps?.strategy ?? 'beforeInteractive').toBe('beforeInteractive')
  })

  it('passes only NEXT_PUBLIC_ variables through to the browser', () => {
    const keys = Object.keys(PublicEnvScript().props.env)

    expect(keys.every((key) => /^NEXT_PUBLIC_/i.test(key))).toBe(true)
  })
})
