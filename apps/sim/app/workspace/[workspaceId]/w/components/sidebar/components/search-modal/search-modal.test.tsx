/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import {
  MOTHERSHIP_SEND_MESSAGE_EVENT,
  type MothershipSendMessageDetail,
} from '@/lib/mothership/events'
import { SearchModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/search-modal'

const { mockPush } = vi.hoisted(() => ({
  mockPush: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1', workflowId: 'workflow-1' }),
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({}),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isChatEnabled: true,
}))

vi.mock('@/lib/posthog/client', () => ({
  captureEvent: vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/global-commands-provider', () => ({
  useInvokeGlobalCommand: () => vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/w/components/sidebar/sidebar', () => ({
  SIDEBAR_SCROLL_EVENT: 'sidebar-scroll-to-item',
}))

vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    config: {
      hideIntegrationsTab: false,
      hideTablesTab: false,
      hideFilesTab: false,
      hideKnowledgeBaseTab: false,
    },
  }),
}))

vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => ({ navigateToSettings: vi.fn() }),
}))

async function enterSearchQuery(query: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search anything"]')
  if (!input) throw new Error('Search input not found')

  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set
    valueSetter?.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('SearchModal', () => {
  let container: HTMLDivElement
  let root: Root
  let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    mockPush.mockClear()
    window.history.replaceState({}, '', '/workspace/workspace-1/w/workflow-1')
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.querySelectorAll('[role="dialog"]').forEach((dialog) => dialog.remove())
    if (originalScrollIntoView) {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
    vi.unstubAllGlobals()
  })

  it('offers a new chat with the query when search has no results', async () => {
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(<SearchModal open onOpenChange={onOpenChange} />)
    })

    await enterSearchQuery('explain quantum rainbows')

    const result = document.querySelector<HTMLElement>('[cmdk-item]')
    expect(document.querySelectorAll('[cmdk-item]')).toHaveLength(1)
    expect(result?.textContent).toBe('New Chat: explain quantum rainbows')
    expect(result?.querySelector('svg')).not.toBeNull()
    expect(result?.getAttribute('aria-selected')).toBe('true')

    act(() => {
      document
        .querySelector<HTMLInputElement>('input[aria-label="Search anything"]')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        )
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockPush).toHaveBeenCalledWith('/workspace/workspace-1/home?handoff=1')
    expect(MothershipHandoffStorage.consume('workspace-1')).toEqual({
      message: 'explain quantum rainbows',
      contexts: undefined,
    })
  })

  it('sends the query directly when the new-chat surface is already mounted', async () => {
    window.history.replaceState({}, '', '/workspace/workspace-1/home')
    const receivedMessages: string[] = []
    const handleMessage = (event: Event) => {
      receivedMessages.push((event as CustomEvent<MothershipSendMessageDetail>).detail.message)
      event.preventDefault()
    }
    window.addEventListener(MOTHERSHIP_SEND_MESSAGE_EVENT, handleMessage)

    try {
      await act(async () => {
        root.render(<SearchModal open onOpenChange={vi.fn()} />)
      })
      await enterSearchQuery('summarize this workspace')

      act(() => {
        document.querySelector<HTMLElement>('[cmdk-item]')?.click()
      })

      expect(receivedMessages).toEqual(['summarize this workspace'])
      expect(mockPush).not.toHaveBeenCalled()
      expect(MothershipHandoffStorage.consume('workspace-1')).toBeNull()
    } finally {
      window.removeEventListener(MOTHERSHIP_SEND_MESSAGE_EVENT, handleMessage)
    }
  })

  it('returns selection to matching results after showing the new-chat fallback', async () => {
    await act(async () => {
      root.render(
        <SearchModal
          open
          onOpenChange={vi.fn()}
          workflows={[
            {
              id: 'workflow-rainbow',
              name: 'Rainbow workflow',
              href: '/workspace/workspace-1/w/workflow-rainbow',
            },
          ]}
        />
      )
    })

    await enterSearchQuery('nothing matches this')
    expect(document.querySelector('[cmdk-item]')?.getAttribute('aria-selected')).toBe('true')

    await enterSearchQuery('rainbow')
    const result = document.querySelector<HTMLElement>('[cmdk-item]')
    expect(result?.textContent).toContain('Rainbow workflow')
    expect(result?.getAttribute('aria-selected')).toBe('true')
  })

  it('orders canvas browse groups as Workflow Actions, Platform Actions, then the standard tail', async () => {
    const workflows = [
      { id: 'workflow-a', name: 'Alpha workflow', href: '/workspace/workspace-1/w/workflow-a' },
    ]
    await act(async () => {
      root.render(
        <SearchModal
          open
          onOpenChange={vi.fn()}
          isOnWorkflowPage
          pageContext='workflow'
          workflows={workflows}
        />
      )
    })

    const headings = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-group-heading]')).map(
      (el) => el.textContent
    )
    expect(headings.slice(0, 4)).toEqual(['Workflow Actions', 'Platform', 'Pages', 'Workflows'])
  })

  it('hoists a module page’s actions and entity section above Platform Actions', async () => {
    const tables = [{ id: 'table-1', name: 'Leads', href: '/workspace/workspace-1/tables/table-1' }]
    await act(async () => {
      root.render(
        <SearchModal open onOpenChange={vi.fn()} pageContext='tables' canEdit tables={tables} />
      )
    })

    const headings = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-group-heading]')).map(
      (el) => el.textContent
    )
    expect(headings.slice(0, 4)).toEqual(['Table Actions', 'Tables', 'Platform', 'Pages'])
  })

  it('browses the integrations catalog from every page', async () => {
    const Icon = () => null
    const integrations = [
      { id: 'slack', name: 'Slack', href: '/integrations/slack', icon: Icon, bgColor: '#611f69' },
    ]
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} integrations={integrations} />)
    })

    const headings = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-group-heading]')).map(
      (el) => el.textContent
    )
    expect(headings).toContain('Integrations')

    await enterSearchQuery('slack')
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map(
      (el) => el.textContent
    )
    expect(rows.some((text) => text?.includes('Slack'))).toBe(true)
  })

  it('re-anchors selection to the first row on every open', async () => {
    const workflows = [
      { id: 'workflow-a', name: 'Alpha workflow', href: '/workspace/workspace-1/w/workflow-a' },
      { id: 'workflow-b', name: 'Beta workflow', href: '/workspace/workspace-1/w/workflow-b' },
    ]
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} workflows={workflows} />)
    })

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search anything"]')
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      )
    })
    const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]'))
    expect(rows()[1]?.getAttribute('aria-selected')).toBe('true')

    await act(async () => {
      root.render(<SearchModal open={false} onOpenChange={vi.fn()} workflows={workflows} />)
    })
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} workflows={workflows} />)
    })

    expect(rows()[0]?.getAttribute('aria-selected')).toBe('true')
    expect(rows()[1]?.getAttribute('aria-selected')).toBe('false')
  })

  it('keeps the palette open when the query handoff cannot be persisted', async () => {
    const onOpenChange = vi.fn()
    const storeSpy = vi.spyOn(MothershipHandoffStorage, 'store').mockReturnValue(false)

    try {
      await act(async () => {
        root.render(<SearchModal open onOpenChange={onOpenChange} />)
      })
      await enterSearchQuery('draft a launch plan')

      act(() => {
        document.querySelector<HTMLElement>('[cmdk-item]')?.click()
      })

      expect(onOpenChange).not.toHaveBeenCalled()
      expect(mockPush).not.toHaveBeenCalled()
    } finally {
      storeSpy.mockRestore()
    }
  })
})
