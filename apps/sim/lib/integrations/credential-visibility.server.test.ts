import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationAvailability } from '@/lib/integrations/availability'
import type { OAuthServiceMetadata } from '@/lib/oauth/types'

const { getBlockMock, getIntegrationAvailabilityMock } = vi.hoisted(() => ({
  getBlockMock: vi.fn(),
  getIntegrationAvailabilityMock: vi.fn(),
}))

vi.mock('@/blocks/registry', () => ({ getBlock: getBlockMock }))
vi.mock('@/lib/integrations/availability.server', () => ({
  getIntegrationAvailability: getIntegrationAvailabilityMock,
  isOAuthServiceDeploymentAvailable: vi.fn(() => true),
}))

import { resolveIntegrationAvailability } from '@/lib/integrations/availability'
import { createIntegrationCredentialVisibility } from '@/lib/integrations/credential-visibility.server'

const SERVICES: readonly OAuthServiceMetadata[] = [
  {
    serviceId: 'notion',
    providerId: 'notion',
    serviceAccountProviderId: 'notion-service-account',
    name: 'Notion',
    description: 'Notion workspace',
    baseProvider: 'notion',
    authType: 'oauth',
  },
  {
    serviceId: 'slack',
    providerId: 'slack',
    serviceAccountProviderId: 'slack-custom-bot',
    name: 'Slack',
    description: 'Slack workspace',
    baseProvider: 'slack',
    authType: 'oauth',
  },
]

function availability(
  type: string,
  state: IntegrationAvailability['state'],
  options: Pick<IntegrationAvailability, 'oauthAvailable' | 'serviceAccountAvailable'>
): IntegrationAvailability {
  return {
    type,
    slug: type,
    name: type,
    state,
    missingFields: [],
    ...options,
  }
}

describe('integration credential visibility', () => {
  beforeEach(() => {
    getBlockMock.mockImplementation((type: string) => ({ type }))
    getIntegrationAvailabilityMock.mockReturnValue([
      availability('notion_v2', 'limited', {
        oauthAvailable: false,
        serviceAccountAvailable: true,
      }),
      availability('slack_v2', 'limited', {
        oauthAvailable: false,
        serviceAccountAvailable: true,
      }),
    ])
  })

  it('exposes Coda token credentials without OAuth while honoring integration policy and visibility', () => {
    const catalog = resolveIntegrationAvailability({})
    expect(catalog.find((entry) => entry.type === 'coda')).toMatchObject({
      state: 'ready',
      oauthAvailable: false,
      serviceAccountAvailable: true,
    })
    getIntegrationAvailabilityMock.mockReturnValue(catalog)
    const service: OAuthServiceMetadata = {
      serviceId: 'coda',
      providerId: 'coda',
      serviceAccountProviderId: 'coda-service-account',
      authType: 'service_account',
      name: 'Coda',
      description: 'Coda token',
      baseProvider: 'coda',
    }
    const identity = { providerId: 'coda-service-account', type: 'service_account' } as const
    const visibility = (allowed: ReadonlySet<string> | null, disabled: boolean) =>
      createIntegrationCredentialVisibility({
        allowedIntegrationTypes: allowed,
        oauthServices: [service],
        blockVisibility: {
          revealed: new Set(),
          previewTagged: new Set(),
          disabled: new Set(disabled ? ['coda'] : []),
        },
      })
    expect(visibility(new Set(['coda']), false).isCredentialVisible(identity)).toBe(true)
    expect(visibility(new Set(['slack_v2']), false).isCredentialVisible(identity)).toBe(false)
    expect(visibility(null, true).isCredentialVisible(identity)).toBe(false)
    getBlockMock.mockReturnValue({ type: 'coda', preview: true })
    expect(visibility(null, false).isCredentialVisible(identity)).toBe(false)
  })

  it('applies the integration allowlist to OAuth and service-account credentials', () => {
    const visibility = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(['slack_v2']),
      blockVisibility: null,
      oauthServices: SERVICES,
    })

    expect(visibility.isCredentialVisible({ providerId: 'notion', type: 'oauth' })).toBe(false)
    expect(
      visibility.isCredentialVisible({
        providerId: 'notion-service-account',
        type: 'service_account',
      })
    ).toBe(false)
  })

  it('keeps an independent service-account fallback when OAuth is unavailable', () => {
    const visibility = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(['notion_v2']),
      blockVisibility: null,
      oauthServices: SERVICES,
    })

    expect(visibility.isCredentialVisible({ providerId: 'notion', type: 'oauth' })).toBe(false)
    expect(
      visibility.isCredentialVisible({
        providerId: 'notion-service-account',
        type: 'service_account',
      })
    ).toBe(true)
  })

  it.each(['unavailable', 'misconfigured'] as const)(
    'allows enrolled OAuth with its own app when deployment OAuth is %s',
    (state) => {
      getIntegrationAvailabilityMock.mockReturnValue([
        availability('slack_v2', state, {
          oauthAvailable: false,
          serviceAccountAvailable: false,
        }),
      ])
      const visibility = createIntegrationCredentialVisibility({
        allowedIntegrationTypes: new Set(['slack_v2']),
        blockVisibility: null,
        oauthServices: SERVICES,
      })
      expect(visibility.isCredentialVisible({ providerId: 'slack', type: 'managed_oauth' })).toBe(
        true
      )
      expect(visibility.isCredentialVisible({ providerId: 'slack', type: 'oauth' })).toBe(false)
    }
  )

  it('still applies allowlists and kill switches to enrolled OAuth', () => {
    for (const blockVisibility of [
      null,
      {
        revealed: new Set(['slack_v2']),
        disabled: new Set(['slack_v2']),
        previewTagged: new Set<string>(),
      },
    ]) {
      const visibility = createIntegrationCredentialVisibility({
        allowedIntegrationTypes: blockVisibility ? new Set(['slack_v2']) : new Set(),
        blockVisibility,
        oauthServices: SERVICES,
      })
      expect(visibility.isCredentialVisible({ providerId: 'slack', type: 'managed_oauth' })).toBe(
        false
      )
      expect(visibility.isCredentialVisible({ providerId: 'unknown', type: 'managed_oauth' })).toBe(
        false
      )
    }
  })

  it('exposes released Slack custom-bot credentials without a preview reveal', () => {
    const visibility = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(['slack_v2']),
      blockVisibility: null,
      oauthServices: SERVICES,
    })

    const credential = { providerId: 'slack-custom-bot', type: 'service_account' } as const
    expect(visibility.isCredentialVisible(credential)).toBe(true)
  })

  it('keeps custom bots available with partial OAuth configuration unless Slack is disabled', () => {
    getIntegrationAvailabilityMock.mockReturnValue([
      availability('slack_v2', 'limited', {
        oauthAvailable: false,
        serviceAccountAvailable: true,
      }),
    ])
    const visibility = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(['slack_v2']),
      blockVisibility: null,
      oauthServices: SERVICES,
    })
    const disabled = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(['slack_v2']),
      blockVisibility: {
        revealed: new Set(['slack_v2']),
        disabled: new Set(['slack_v2']),
        previewTagged: new Set(['slack_v2']),
      },
      oauthServices: SERVICES,
    })

    const credential = {
      providerId: 'slack-custom-bot',
      type: 'service_account',
    } as const
    expect(visibility.isCredentialVisible(credential)).toBe(true)
    expect(disabled.isCredentialVisible(credential)).toBe(false)
  })

  it('leaves non-integration credentials visible', () => {
    const visibility = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(),
      blockVisibility: null,
      oauthServices: SERVICES,
    })

    expect(
      visibility.isCredentialVisible({
        providerId: 'claude-platform',
        type: 'service_account',
      })
    ).toBe(true)
  })
})
