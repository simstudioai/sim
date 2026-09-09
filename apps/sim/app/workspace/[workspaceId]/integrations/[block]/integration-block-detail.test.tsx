/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Integration } from '@/lib/integrations/types'

const { availabilityState, mockPush } = vi.hoisted(() => ({
  /** `null` stands for an availability answer that has not arrived. */
  availabilityState: {
    availability: null as { state: string; oauthAvailable: boolean } | null,
    isLoading: false,
  },
  mockPush: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
vi.mock('nuqs', () => ({ useQueryState: () => [null, vi.fn()] }))
vi.mock('@/hooks/use-oauth-return', () => ({ useOAuthReturnRouter: () => {} }))
vi.mock('@/hooks/queries/credentials', () => ({
  useWorkspaceCredentials: () => ({ data: [], isPending: false }),
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/hooks/use-scroll-restoration', () => ({
  useScrollRestoration: () => {},
}))
vi.mock('@/lib/core/config/deployment-shape', () => ({
  useDeploymentShape: () => ({ chatEnabled: true }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map(
      availabilityState.availability
        ? [
            ['snowflake', availabilityState.availability],
            ['jira', availabilityState.availability],
          ]
        : []
    ),
    isLoading: availabilityState.isLoading,
  }),
}))

/** Heavy leaf sections carry their own coverage; the header is what is under test. */
vi.mock('@/app/workspace/[workspaceId]/integrations/[block]/integration-skills-section', () => ({
  IntegrationSkillsSection: () => null,
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/components/integration-section', () => ({
  IntegrationSection: () => null,
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/components/integrations-showcase', () => ({
  IntegrationTile: () => null,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: () => null,
  })
)
vi.mock('@/app/workspace/[workspaceId]/components/connect-oauth-modal', () => ({
  ConnectOAuthModal: () => <div data-testid='oauth-modal' />,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/integrations/components/connect-personal-token-modal',
  () => ({
    ConnectPersonalTokenModal: () => null,
  })
)
vi.mock('@/blocks/registry', () => ({
  getTemplatesForBlock: () => [],
  getSuggestedSkillsForBlock: () => [],
}))

import { getServiceAccountConnectNoun } from '@/lib/credentials/service-account-provider-ids'
import { INTEGRATIONS } from '@/lib/integrations'
import { IntegrationBlockDetail } from '@/app/workspace/[workspaceId]/integrations/[block]/integration-block-detail'

/** Snowflake authenticates only with a stored service account; Jira also offers OAuth. */
const SERVICE_ACCOUNT_ONLY = INTEGRATIONS.find((i) => i.slug === 'snowflake') as Integration
const OAUTH_WITH_SERVICE_ACCOUNT = INTEGRATIONS.find((i) => i.slug === 'jira') as Integration

/**
 * Derived rather than written out: the vendor-accurate noun is owned by
 * `getServiceAccountConnectNoun`, so hardcoding it here would make this test
 * fail on a copy change that is none of its business.
 */
const STORED_CREDENTIAL_LABEL = `Add ${getServiceAccountConnectNoun('snowflake-service-account')}`

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(integration: Integration) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(<IntegrationBlockDetail integration={integration} workspaceId='workspace-1' />)
  )
}

/**
 * The header's primary action, tagged by control kind. The tag matters: a
 * `ChipDropdown` trigger renders the same "Add to Sim" placeholder as the plain
 * chip, so comparing label text alone cannot tell one connect option from two.
 * Radix marks its trigger with `aria-haspopup`; a bare `Chip` carries none.
 */
function headerAction(): string {
  const bar = container?.firstElementChild?.firstElementChild
  const buttons = Array.from(bar?.querySelectorAll('button') ?? [])
  return buttons
    .map((b) => `${b.hasAttribute('aria-haspopup') ? 'dropdown' : 'chip'}:${b.textContent?.trim()}`)
    .join('|')
}

beforeEach(() => {
  mockPush.mockClear()
  availabilityState.availability = { state: 'ready', oauthAvailable: false }
  availabilityState.isLoading = false
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('IntegrationBlockDetail header action', () => {
  it('offers the stored service account for an integration with no OAuth path', () => {
    mount(SERVICE_ACCOUNT_ONLY)

    expect(headerAction()).toContain(`chip:${STORED_CREDENTIAL_LABEL}`)
  })

  it('keeps offering it while the availability answer is still in flight', () => {
    availabilityState.availability = null
    availabilityState.isLoading = true
    mount(SERVICE_ACCOUNT_ONLY)

    expect(headerAction()).toContain(`chip:${STORED_CREDENTIAL_LABEL}`)
  })

  /**
   * A failed request leaves availability unresolved once loading ends. Hiding the
   * control there strands a user who has a valid stored account behind a fetch
   * they cannot retry, so it fails open — the server still refuses a provider the
   * deployment does not offer.
   */
  it('fails open when the availability request settles with no answer', () => {
    availabilityState.availability = null
    availabilityState.isLoading = false
    mount(SERVICE_ACCOUNT_ONLY)

    expect(headerAction()).toContain(`chip:${STORED_CREDENTIAL_LABEL}`)
  })

  /**
   * The OAuth path already defaults to available while unknown, so relaxing the
   * service-account one too would widen this header from a chip to a dropdown and
   * collapse it again as the config lands.
   */
  it('does not add a second option to an OAuth integration while loading', () => {
    availabilityState.availability = null
    availabilityState.isLoading = true
    mount(OAUTH_WITH_SERVICE_ACCOUNT)

    expect(headerAction()).toBe('chip:Add to Sim')
  })

  /**
   * "Unavailable" is a verdict about a connection the deployment grants. An
   * integration authenticated by a stored service account still runs on the
   * user's own API key, so it keeps the ordinary call to action instead.
   */
  it('never calls a stored-credential integration unavailable', () => {
    availabilityState.availability = { state: 'unavailable', oauthAvailable: false }
    mount(SERVICE_ACCOUNT_ONLY)

    const action = headerAction()
    expect(action).not.toContain('Unavailable')
    expect(action).toContain('chip:Add to Sim')
  })

  it('still calls an OAuth integration unavailable when its client is missing', () => {
    availabilityState.availability = { state: 'unavailable', oauthAvailable: false }
    mount(OAUTH_WITH_SERVICE_ACCOUNT)

    expect(headerAction()).toContain('chip:Unavailable')
  })
})
