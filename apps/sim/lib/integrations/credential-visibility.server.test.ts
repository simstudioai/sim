/**
 * @vitest-environment node
 */

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
    vi.clearAllMocks()
    getBlockMock.mockImplementation((type: string) => ({
      type,
      ...(type === 'slack_v2' ? { preview: true } : {}),
    }))
    getIntegrationAvailabilityMock.mockReturnValue([
      availability('notion_v2', 'limited', {
        oauthAvailable: false,
        serviceAccountAvailable: true,
      }),
      availability('slack', 'unavailable', {
        oauthAvailable: false,
        serviceAccountAvailable: false,
      }),
    ])
  })

  it('applies the integration allowlist to OAuth and service-account credentials', () => {
    const visibility = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(['slack']),
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

  it('requires the Slack preview reveal for custom-bot credentials', () => {
    const hidden = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(['slack']),
      blockVisibility: null,
      oauthServices: SERVICES,
    })
    const revealed = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(['slack']),
      blockVisibility: {
        revealed: new Set(['slack_v2']),
        disabled: new Set(),
        previewTagged: new Set(['slack_v2']),
      },
      oauthServices: SERVICES,
    })

    const credential = { providerId: 'slack-custom-bot', type: 'service_account' } as const
    expect(hidden.isCredentialVisible(credential)).toBe(false)
    expect(revealed.isCredentialVisible(credential)).toBe(true)
  })

  it('projects partial OAuth state through a revealed service-account preview', () => {
    getIntegrationAvailabilityMock.mockReturnValue([
      availability('slack', 'misconfigured', {
        oauthAvailable: false,
        serviceAccountAvailable: false,
      }),
    ])
    const visibility = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(['slack']),
      blockVisibility: {
        revealed: new Set(['slack_v2']),
        disabled: new Set(),
        previewTagged: new Set(['slack_v2']),
      },
      oauthServices: SERVICES,
    })
    const disabled = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(['slack']),
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
