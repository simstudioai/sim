/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackgroundWorkItem } from '@/lib/api/contracts/workspace-fork'

const { mockUseWorkspaceBackgroundWork } = vi.hoisted(() => ({
  mockUseWorkspaceBackgroundWork: vi.fn(),
}))

vi.mock('@/ee/workspace-forking/hooks/background-work', () => ({
  useWorkspaceBackgroundWork: mockUseWorkspaceBackgroundWork,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/components', () => ({
  FloatingOverflowText: ({ label, className }: { label: string; className?: string }) => (
    <span className={className}>{label}</span>
  ),
}))

import { ForkActivityPanel } from '@/ee/workspace-forking/components/fork-activity-panel/fork-activity-panel'

const WORKSPACE_ID = 'ws-1'
const PARTNER_ID = 'ws-parent'
const WORKSPACE_NAMES = new Map([[PARTNER_ID, 'another workspace']])

function makeJob(overrides: Partial<BackgroundWorkItem> = {}): BackgroundWorkItem {
  return {
    id: 'job-1',
    workspaceId: PARTNER_ID,
    workflowId: null,
    kind: 'fork_content_copy',
    status: 'completed',
    message: null,
    error: null,
    metadata: { childWorkspaceId: WORKSPACE_ID, actorName: 'Brandon Tarr' },
    startedAt: '2026-07-28T15:58:00.000Z',
    completedAt: null,
    ...overrides,
  } as BackgroundWorkItem
}

let container: HTMLDivElement
let root: Root

function renderJobs(jobs: BackgroundWorkItem[]) {
  mockUseWorkspaceBackgroundWork.mockReturnValue({
    data: { pages: [{ items: jobs, nextCursor: null }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  })
  act(() => {
    root.render(<ForkActivityPanel workspaceId={WORKSPACE_ID} workspaceNames={WORKSPACE_NAMES} />)
  })
}

/** The Event-column badge for the single rendered row (`Badge`'s base class). */
function badgeElement(): HTMLElement {
  const badge = container.querySelector<HTMLElement>('.inline-flex')
  if (!badge) throw new Error('badge not found')
  return badge
}

/** Hover the badge the way React sees it — `onPointerEnter` is delegated from `pointerover`. */
function hover(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(
      new MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 })
    )
  })
}

function tooltipText(): string | null {
  return document.body.querySelector('[role="tooltip"]')?.textContent ?? null
}

describe('ForkActivityPanel event badge tooltip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows the failure reason when hovering a failed (red) badge', () => {
    renderJobs([makeJob({ status: 'failed', error: 'Storage quota exceeded while copying files' })])

    expect(tooltipText()).toBeNull()
    hover(badgeElement())
    expect(tooltipText()).toBe('Storage quota exceeded while copying files')
  })

  it('falls back to a generic label when a failed row carries no error text', () => {
    renderJobs([makeJob({ status: 'failed', error: null })])

    hover(badgeElement())
    expect(tooltipText()).toBe('Failed')
  })

  it('truncates a very long failure reason', () => {
    renderJobs([makeJob({ status: 'failed', error: 'x'.repeat(500) })])

    hover(badgeElement())
    const text = tooltipText() ?? ''
    expect(text.endsWith('...')).toBe(true)
    expect(text.length).toBeLessThan(260)
  })

  it('says "In progress" when hovering a processing (grey) badge', () => {
    renderJobs([makeJob({ status: 'processing' })])

    hover(badgeElement())
    expect(tooltipText()).toBe('In progress')
  })

  it('says "Queued" when hovering a pending (grey) badge', () => {
    renderJobs([makeJob({ status: 'pending' })])

    hover(badgeElement())
    expect(tooltipText()).toBe('Queued')
  })

  it('shows nothing when hovering a completed (blue) badge', () => {
    renderJobs([makeJob({ status: 'completed' })])

    hover(badgeElement())
    expect(tooltipText()).toBeNull()
  })

  it('surfaces the partial-copy summary on a completed_with_warnings (amber) badge', () => {
    renderJobs([
      makeJob({
        status: 'completed_with_warnings',
        message: 'Copied 12 items; 3 could not be copied',
      }),
    ])

    hover(badgeElement())
    expect(tooltipText()).toBe('Copied 12 items; 3 could not be copied')
  })

  it('keeps a still-running row hoverable by not rendering it as a disabled button', () => {
    renderJobs([makeJob({ status: 'processing' })])

    // A processing row has no report yet, so it is not expandable. It must still
    // be a plain row — a disabled button would swallow the badge's hover events.
    expect(container.querySelector('button[disabled]')).toBeNull()
  })

  it('still renders an expandable row as a button', () => {
    renderJobs([makeJob({ status: 'failed', error: 'boom' })])

    const row = container.querySelector('button')
    expect(row).not.toBeNull()
    expect(row?.getAttribute('aria-expanded')).toBe('false')
  })
})
