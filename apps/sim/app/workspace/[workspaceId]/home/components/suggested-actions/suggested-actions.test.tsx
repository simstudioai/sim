/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCaptureEvent, mockUseSearchCredentials } = vi.hoisted(() => ({
  mockCaptureEvent: vi.fn(),
  mockUseSearchCredentials: vi.fn(),
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
vi.mock('@/app/workspace/[workspaceId]/search/hooks/use-search-credentials', () => ({
  useSearchCredentials: mockUseSearchCredentials,
}))

/** The Build-mode pool is built from the block catalog at module load; an empty catalog keeps it to the table starters. */
vi.mock('@/blocks/registry', () => ({ getAllBlockMeta: () => ({}), getAllBlocks: () => [] }))

vi.mock('@/lib/sim-search/connectors', () => {
  const icon = () => null
  const connector = (type: string, name: string, providerId: string) => ({
    type,
    meta: { id: type, name, description: `Sync ${name}`, icon },
    providerId,
    requiredScopes: ['read'],
    serviceName: name,
    serviceIcon: icon,
    blockType: type,
  })
  return {
    SEARCH_CONNECTORS: [
      connector('airtable', 'Airtable', 'airtable'),
      connector('confluence', 'Confluence', 'confluence'),
      connector('jira', 'Jira', 'jira'),
      connector('jsm', 'Jira Service Management', 'jira'),
      connector('notion', 'Notion', 'notion'),
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

function connectModal(): string | null {
  return document.querySelector('[data-testid="connect-modal"]')?.textContent ?? null
}

beforeEach(() => {
  onSelectPrompt.mockClear()
  mockCaptureEvent.mockClear()
  mockUseSearchCredentials.mockReturnValue({
    credentials: [{ id: 'cred-jira', providerId: 'jira' }],
    isPending: false,
  })
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

  it('swaps to the connector list in Search mode, minus providers already connected', () => {
    mount()

    act(() => useMothershipModeStore.getState().setMode('search'))

    expect(heading()).toBe('Connect Sim Search')
    expect(rows().map((row) => row.textContent)).toEqual([
      'Connect Confluence',
      'Connect Airtable',
      'Connect Notion',
    ])
  })

  it('opens the OAuth connect modal for a connector row instead of populating the input', () => {
    mount()
    act(() => useMothershipModeStore.getState().setMode('search'))
    expect(connectModal()).toBeNull()

    act(() => {
      rows()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    })

    expect(connectModal()).toBe('confluence')
    expect(onSelectPrompt).not.toHaveBeenCalled()
    expect(mockCaptureEvent).toHaveBeenCalledWith(
      null,
      'suggested_action_clicked',
      expect.objectContaining({ kind: 'connector', action_id: 'connect-confluence', position: 0 })
    )
  })
})
