/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCaptureEvent, mockCredentials } = vi.hoisted(() => ({
  mockCaptureEvent: vi.fn(),
  mockCredentials: vi.fn(() => ({ data: [] })),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/lib/posthog/client', () => ({ captureEvent: mockCaptureEvent }))
vi.mock('@sim/utils/random', () => ({ randomFloat: () => 0 }))

vi.mock('@/hooks/queries/credentials', () => ({
  useWorkspaceCredentials: mockCredentials,
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
/** The suggestion pool is built from the block catalog at module load; an empty catalog keeps it to the table starters. */
vi.mock('@/blocks/registry', () => ({ getAllBlockMeta: () => ({}), getAllBlocks: () => [] }))

vi.mock('@/app/workspace/[workspaceId]/components/connect-oauth-modal', () => ({
  ConnectOAuthModal: ({ open, providerId }: { open: boolean; providerId: string }) =>
    open ? <div data-testid='connect-modal'>{providerId}</div> : null,
}))

import { SuggestedActions } from '@/app/workspace/[workspaceId]/home/components/suggested-actions/suggested-actions'

let root: Root | null = null
let container: HTMLDivElement | null = null
const onSelectPrompt = vi.fn()

function mount(organizationId?: string) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <SuggestedActions organizationId={organizationId} onSelectPrompt={onSelectPrompt} />
    )
  )
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
  mockCredentials.mockClear()
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('SuggestedActions', () => {
  it('shows suggested actions', () => {
    mount()

    expect(heading()).toBe('Suggested actions')
    expect(rows().map((row) => row.textContent)).toContain('Integrate with Slack')
  })

  it('keeps suggestion actions interactive', () => {
    mount()
    const action = rows().find((row) => row.textContent === 'Create a CRM with sample data')
    expect(action).toBeDefined()
    act(() => action?.click())
    expect(onSelectPrompt).toHaveBeenCalledWith('Create a CRM with sample data.')
  })
})

it('uses org integration suggestions as prompts without opening workspace OAuth', () => {
  mount('organization-1')
  act(() =>
    rows()
      .find((row) => row.textContent === 'Integrate with Slack')
      ?.click()
  )
  expect(onSelectPrompt).toHaveBeenCalledWith('Integrate with Slack.')
  expect(container?.querySelector('[data-testid="connect-modal"]')).toBeNull()
  expect(mockCredentials).toHaveBeenCalledWith({ workspaceId: undefined, enabled: false })
})

it('keeps workspace integration suggestions connected to their OAuth flow', () => {
  mount()
  act(() =>
    rows()
      .find((row) => row.textContent === 'Integrate with Slack')
      ?.click()
  )
  expect(container?.querySelector('[data-testid="connect-modal"]')).not.toBeNull()
  expect(onSelectPrompt).not.toHaveBeenCalled()
})
