/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  setup: vi.fn(),
  error: null as Error | null,
  pending: false,
}))
vi.mock('@/hooks/queries/organization-account-indexing', () => ({
  useUpdateOrganizationAccountIndexing: () => ({
    mutate: mocks.update,
    error: mocks.error,
    isPending: mocks.pending,
  }),
}))

import { OrganizationAccountIndexing } from '@/ee/credential-groups/components/organization-account-indexing'

const source: SearchSourceSummary = {
  knowledgeBaseId: 'kb-1',
  connectorId: 'connector-1',
  connectorType: 'gmail',
  sourceDescription: '',
  accessMode: 'members',
  availability: 'available',
  enabled: true,
  isSyncing: false,
  lastSyncAt: null,
  hasSyncError: false,
  viewerDocumentCount: 0,
  viewerEmailVerified: true,
  connectionRequired: true,
  viewerMembership: 'connected',
}

describe('organization account indexing switch', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.error = null
    mocks.pending = false
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })
  async function render(sources: SearchSourceSummary[], available = true) {
    await act(async () =>
      root.render(
        <OrganizationAccountIndexing
          organizationId='org-1'
          optionId='option-1'
          providerName='Gmail'
          sources={sources}
          available={available}
          disabled={false}
          onSetup={mocks.setup}
        />
      )
    )
  }
  async function choose(label: string) {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (node) => node.textContent === label
    )
    expect(button).toBeDefined()
    await act(async () => button?.click())
  }
  it('opens setup for an unconfigured provider without claiming indexing has started', async () => {
    await render([])
    await choose('On')
    expect(mocks.setup).toHaveBeenCalledOnce()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-checked="true"]')?.textContent).toBe('Off')
  })
  it('pauses existing indexing using the org and option identity', async () => {
    await render([source])
    expect(container.querySelector('[aria-checked="true"]')?.textContent).toBe('On')
    await choose('Off')
    expect(mocks.update).toHaveBeenCalledWith({
      organizationId: 'org-1',
      optionId: 'option-1',
      enabled: false,
    })
  })
  it('resumes an existing paused source without opening setup again', async () => {
    await render([{ ...source, enabled: false }])
    await choose('On')
    expect(mocks.update).toHaveBeenCalledWith({
      organizationId: 'org-1',
      optionId: 'option-1',
      enabled: true,
    })
    expect(mocks.setup).not.toHaveBeenCalled()
  })
  it('keeps a failed pause visible and surfaces the server error', async () => {
    mocks.error = new Error('Indexing is running')
    await render([source])
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Indexing is running')
    expect(container.querySelector('[aria-checked="true"]')?.textContent).toBe('On')
  })
  it('explains a disabled Search feature and prevents enabling', async () => {
    await render([], false)
    expect(container.textContent).toContain('Search is not enabled')
    await choose('On')
    expect(mocks.setup).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('still allows pausing when Search becomes unavailable', async () => {
    await render([source], false)
    await choose('Off')
    expect(mocks.update).toHaveBeenCalledWith({
      organizationId: 'org-1',
      optionId: 'option-1',
      enabled: false,
    })
  })
  it('prevents duplicate changes while a save is pending', async () => {
    mocks.pending = true
    await render([source])
    await choose('Off')
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
