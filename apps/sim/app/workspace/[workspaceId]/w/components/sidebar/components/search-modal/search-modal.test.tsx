/**
 * @vitest-environment jsdom
 */
import type { ComponentType } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@sim/emcn', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  Library: () => <svg aria-hidden='true' />,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-current' }),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('posthog-js/react', () => ({
  usePostHog: () => null,
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

vi.mock('@/lib/posthog/client', () => ({
  captureEvent: vi.fn(),
}))

vi.mock('@/lib/workflows/triggers/trigger-utils', () => ({
  hasTriggerCapability: () => false,
}))

import { SearchModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/search-modal'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { SEARCH_SECTIONS } from '@/stores/modals/search/types'

function TestIcon() {
  return <svg aria-hidden='true' />
}

const workspace = {
  id: 'workspace-acme',
  name: 'Acme',
  href: '/workspace/workspace-acme/w',
}

const chat = {
  id: 'chat-acme',
  name: 'Acme',
  href: '/workspace/workspace-current/chat/chat-acme',
}

class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

let container: HTMLDivElement
let root: Root
const originalScrollIntoView = Element.prototype.scrollIntoView

function headings(): string[] {
  return [...document.body.querySelectorAll('[cmdk-group-heading]')].map(
    (heading) => heading.textContent ?? ''
  )
}

async function renderSearchModal({
  isOnWorkflowPage = false,
}: {
  isOnWorkflowPage?: boolean
} = {}) {
  await act(async () => {
    root.render(
      <SearchModal
        open
        onOpenChange={vi.fn()}
        workspaces={[workspace]}
        chats={[chat]}
        isOnWorkflowPage={isOnWorkflowPage}
      />
    )
  })
}

async function searchFor(value: string) {
  const input = document.body.querySelector<HTMLInputElement>('[cmdk-input]')
  if (!input) throw new Error('Search input not found')
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set
  if (!nativeInputValueSetter) throw new Error('Native input value setter not found')

  await act(async () => {
    nativeInputValueSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  Element.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useSearchModalStore.setState({
    isOpen: true,
    sections: null,
    pendingConnect: null,
    data: {
      blocks: [],
      tools: [],
      triggers: [],
      toolOperations: [],
      docs: [],
      isInitialized: true,
    },
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  if (originalScrollIntoView) {
    Element.prototype.scrollIntoView = originalScrollIntoView
  } else {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  }
})

describe('SearchModal section ordering', () => {
  it('renders Workspaces directly after Actions and before Chats', async () => {
    await renderSearchModal()

    expect(SEARCH_SECTIONS.slice(0, 2)).toEqual(['actions', 'workspaces'])
    expect(headings().slice(0, 3)).toEqual(['Actions', 'Workspaces', 'Chats'])
  })

  it('keeps a matching workspace ahead of a matching chat', async () => {
    await renderSearchModal()
    await searchFor('Acme')

    expect(headings()).toEqual(['Workspaces', 'Chats'])
  })

  it('does not add Workspaces to a canvas-restricted palette', async () => {
    useSearchModalStore.setState({
      sections: ['blocks', 'tools', 'toolOperations'],
      data: {
        blocks: [
          {
            id: 'agent',
            name: 'Agent',
            icon: TestIcon as ComponentType<{ className?: string }>,
            bgColor: '#000000',
            type: 'agent',
          },
        ],
        tools: [],
        triggers: [],
        toolOperations: [],
        docs: [],
        isInitialized: true,
      },
    })

    await renderSearchModal({ isOnWorkflowPage: true })

    expect(headings()).toEqual(['Blocks'])
    expect(document.body).not.toHaveTextContent('Workspaces')
    expect(document.body).not.toHaveTextContent('Acme')
  })
})
