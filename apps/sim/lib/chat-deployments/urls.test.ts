/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, resetEnvMock, setEnv, setEnvFlags } from '@sim/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { buildChatDeploymentUrl } from '@/lib/chat-deployments/urls'

describe('buildChatDeploymentUrl', () => {
  afterEach(() => {
    resetEnvMock()
    resetEnvFlagsMock()
  })

  it('serves the chat from the app host on the /chat/ path', () => {
    setEnv({ NEXT_PUBLIC_APP_URL: 'https://sim.ai' })

    expect(buildChatDeploymentUrl('support')).toBe('https://sim.ai/chat/support')
  })

  it('strips the www prefix, because the deployed chat answers on the bare host', () => {
    setEnv({ NEXT_PUBLIC_APP_URL: 'https://www.sim.ai' })

    expect(buildChatDeploymentUrl('support')).toBe('https://sim.ai/chat/support')
  })

  /**
   * `getBaseUrl` throws when the variable is unset, so a self-host missing it
   * would otherwise fail every chat read and update with a `500` — where the
   * derivation this consolidated already fell back instead.
   */
  it('falls back instead of throwing when NEXT_PUBLIC_APP_URL is unset', () => {
    setEnv({ NEXT_PUBLIC_APP_URL: undefined })
    setEnvFlags({ isDev: true })

    expect(buildChatDeploymentUrl('support')).toBe('http://localhost:3000/chat/support')
  })
})
