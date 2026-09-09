/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCaptureEvent, mockRouterPush, modeState, connectionState } = vi.hoisted(() => ({
  mockCaptureEvent: vi.fn(),
  mockRouterPush: vi.fn(),
  modeState: { initial: 'build', set: (_next: string) => {} },
  /** Drives the personalized Build list; empty keeps the component on INITIAL_ACTIONS. */
  connectionState: {
    credentials: [] as { type: string; providerId: string }[],
    services: [] as { providerId: string; name: string; icon: () => null }[],
  },
}))

vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-mothership-mode', async () => {
  const { useState } = await import('react')
  return {
    useMothershipMode: () => {
      const [mode, setMode] = useState(modeState.initial)
      modeState.set = setMode
      return [mode, setMode]
    },
  }
})

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  useRouter: () => ({ push: mockRouterPush }),
}))
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/lib/posthog/client', () => ({ captureEvent: mockCaptureEvent }))
vi.mock('@sim/utils/random', () => ({ randomFloat: () => 0 }))

vi.mock('@/hooks/queries/credentials', () => ({
  useWorkspaceCredentials: () => ({ data: connectionState.credentials }),
}))
vi.mock('@/hooks/queries/oauth/oauth-connections', () => ({
  useOAuthConnections: () => ({ data: connectionState.services }),
}))
vi.mock('@/hooks/queries/tables', () => ({
  useTablesList: () => ({ data: [] }),
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useKnowledgeBasesQuery: () => ({ data: [] }),
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/search-sources', () => ({
  SearchSources: () => <div data-testid='search-sources' />,
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map([['notion', { state: 'unavailable', oauthAvailable: false }]]),
  }),
}))

/** The Build-mode pool is built from the block catalog at module load; an empty catalog keeps it to the table starters. */
vi.mock('@/blocks/registry', () => ({ getAllBlockMeta: () => ({}), getAllBlocks: () => [] }))

vi.mock('@/lib/sim-search/connectors', () => {
  const icon = () => null
  const connector = (type: string, name: string, providerId: string) => ({
    type,
    meta: { id: type, name, description: `Sync ${name}`, icon },
    providerId,
    providerIds: [providerId],
    requiredScopes: ['read'],
    serviceName: name,
    serviceIcon: icon,
    blockType: type,
  })
  return {
    isSearchConnectorAvailable: (
      candidate: { blockType: string },
      availability: ReadonlyMap<string, { oauthAvailable: boolean }>
    ) => availability.get(candidate.blockType)?.oauthAvailable ?? true,
    SEARCH_CONNECTORS: [
      connector('airtable', 'Airtable', 'airtable'),
      connector('confluence', 'Confluence', 'confluence'),
      connector('jira', 'Jira', 'jira'),
      connector('jsm', 'Jira Service Management', 'jira'),
      connector('notion', 'Notion', 'notion'),
      connector('slack', 'Slack', 'slack'),
    ],
  }
})

vi.mock('@/app/workspace/[workspaceId]/components/connect-oauth-modal', () => ({
  ConnectOAuthModal: ({ open, providerId }: { open: boolean; providerId: string }) =>
    open ? <div data-testid='connect-modal'>{providerId}</div> : null,
}))

import { SuggestedActions } from '@/app/workspace/[workspaceId]/home/components/suggested-actions/suggested-actions'

let root: Root | null = null
let container: HTMLDivElement | null = null
const onSelectPrompt = vi.fn()

function mount() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<SuggestedActions onSelectPrompt={onSelectPrompt} />))
}

function heading(): string {
  return container?.querySelector('button[aria-expanded] span')?.textContent ?? ''
}

function rows(): HTMLButtonElement[] {
  return Array.from(
    container?.querySelectorAll<HTMLButtonElement>('button:not([aria-expanded])') ?? []
  )
}

beforeEach(() => {
  onSelectPrompt.mockClear()
  mockCaptureEvent.mockClear()
  mockRouterPush.mockClear()
  modeState.initial = 'build'
  connectionState.credentials = []
  connectionState.services = []
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('SuggestedActions', () => {
  /**
   * Snowflake authenticates with a stored service account, so the catalog holds
   * no OAuth service for its slug and the inline modal cannot open. The row is
   * still offered — `defineServices` enumerates every OAuth provider, including
   * the service-account ones — so before this handoff the click resolved no
   * target and was silently dropped.
   */
  it('hands a stored-service-account row to its detail page instead of dropping the click', () => {
    connectionState.credentials = [{ type: 'oauth', providerId: 'gmail' }]
    connectionState.services = [{ providerId: 'snowflake', name: 'Snowflake', icon: () => null }]
    mount()

    const row = rows().find((candidate) => candidate.textContent === 'Integrate with Snowflake')
    expect(row).toBeDefined()
    act(() => row?.click())

    expect(mockRouterPush).toHaveBeenCalledWith(
      '/workspace/workspace-1/integrations/snowflake?connect=service-account'
    )
    expect(container?.querySelector('[data-testid="connect-modal"]')).toBeNull()
  })

  it('shows the Build starters by default', () => {
    mount()

    expect(heading()).toBe('Suggested actions')
    expect(rows().map((row) => row.textContent)).toContain('Integrate with Slack')
  })

  it('shows every source in Search mode instead of the sampled suggestions', () => {
    mount()

    act(() => modeState.set('search'))

    expect(heading()).toBe('Sources')
    expect(document.querySelector('[data-testid="search-sources"]')).not.toBeNull()
    expect(rows()).toHaveLength(0)
  })

  it('shows the sources in Assistant mode, which answers from them', () => {
    mount()

    act(() => modeState.set('assistant'))

    expect(heading()).toBe('Sources')
    expect(document.querySelector('[data-testid="search-sources"]')).not.toBeNull()
    expect(rows()).toHaveLength(0)
  })
})
