/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://www.sim.ai"}
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  vi.stubEnv('NEXT_PUBLIC_FORCE_HOSTED', 'false')
  vi.stubEnv('NODE_ENV', 'production')
  document.documentElement.id = '__next_error__'
})

vi.unmock('@/lib/core/config/env')
vi.unmock('@/lib/core/config/env-flags')
vi.mock('@/lib/oauth/utils', () => ({ getScopesForService: () => [] }))
vi.mock('@/providers/utils', () => ({ getProviderFromModel: () => 'openai' }))

import { getEnv, PUBLIC_ENV_ATTRIBUTE } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/env-flags'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { getApiKeyCondition } from '@/blocks/utils'
import { getHostedModels } from '@/providers/models'

describe('hosted detection during client recovery', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(PUBLIC_ENV_ATTRIBUTE)
    Reflect.deleteProperty(window, '__ENV')
  })

  it('hides hosted model keys before the recovered layout installs runtime configuration', () => {
    expect(window.__ENV).toBeUndefined()
    expect(document.documentElement.getAttribute(PUBLIC_ENV_ATTRIBUTE)).toBeNull()
    expect(isHosted).toBe(true)

    for (const model of ['gpt-5.6-sol', 'claude-sonnet-5', 'gemini-2.5-pro']) {
      expect(getHostedModels()).toContain(model)
      expect(evaluateSubBlockCondition(getApiKeyCondition(), { model })).toBe(false)
    }

    document.documentElement.setAttribute(
      PUBLIC_ENV_ATTRIBUTE,
      JSON.stringify({ NEXT_PUBLIC_APP_URL: 'https://www.sim.ai' })
    )

    expect(getEnv('NEXT_PUBLIC_APP_URL')).toBe('https://www.sim.ai')
    expect(isHosted).toBe(true)
    expect(evaluateSubBlockCondition(getApiKeyCondition(), { model: 'gpt-5.6-sol' })).toBe(false)
  })

  it('still requires keys for models outside the hosted catalog', () => {
    expect(evaluateSubBlockCondition(getApiKeyCondition(), { model: 'custom/model' })).toBe(true)
  })
})
