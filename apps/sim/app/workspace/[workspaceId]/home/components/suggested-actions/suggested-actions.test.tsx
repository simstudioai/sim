/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCaptureEvent } = vi.hoisted(() => ({
  mockCaptureEvent: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/lib/posthog/client', () => ({ captureEvent: mockCaptureEvent }))
vi.mock('@sim/utils/random', () => ({ randomFloat: () => 0 }))

vi.mock('@/hooks/queries/credentials', () => ({
  useWorkspaceCredentials: () => ({ data: [] }),
}))
vi.mock('@/hooks/queries/oauth/oauth-connections', () => ({
  useOAuthConnections: () => ({ data: [] }),
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
import { useMothershipModeStore } from '@/stores/mothership-mode/store'

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
  useMothershipModeStore.getState().reset()
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('SuggestedActions', () => {
  it('shows the Build starters by default', () => {
    mount()

    expect(heading()).toBe('Suggested actions')
    expect(rows().map((row) => row.textContent)).toContain('Integrate with Slack')
  })

  it('shows every source in Search mode instead of the sampled suggestions', () => {
    mount()

    act(() => useMothershipModeStore.getState().setMode('search'))

    expect(heading()).toBe('Sources')
    expect(document.querySelector('[data-testid="search-sources"]')).not.toBeNull()
    expect(rows()).toHaveLength(0)
  })

  it('shows the sources in Ask mode, which answers from them', () => {
    mount()

    act(() => useMothershipModeStore.getState().setMode('ask'))

    expect(heading()).toBe('Sources')
    expect(document.querySelector('[data-testid="search-sources"]')).not.toBeNull()
    expect(rows()).toHaveLength(0)
  })
})
