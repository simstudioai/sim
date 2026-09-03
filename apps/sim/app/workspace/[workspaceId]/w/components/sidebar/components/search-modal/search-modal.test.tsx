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
import { getBlock } from '@/blocks/registry'

const { mockPush, mockSearchState } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockSearchState: {
    data: {
      blocks: [] as unknown[],
      tools: [] as unknown[],
      triggers: [] as unknown[],
      toolOperations: [] as unknown[],
      isInitialized: true,
    },
  },
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1', workflowId: 'workflow-1' }),
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({}),
}))

vi.mock('@/lib/posthog/client', () => ({
  captureEvent: vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/global-commands-provider', () => ({
  useInvokeGlobalCommand: () => vi.fn(),
}))

vi.mock('@/lib/workflows/triggers/trigger-utils', () => ({
  hasTriggerCapability: () => false,
}))

vi.mock('@/stores/modals/search/store', () => ({
  useSearchModalStore: Object.assign(
    (selector: (state: typeof mockSearchState) => unknown) => selector(mockSearchState),
    { getState: () => mockSearchState }
  ),
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

/**
 * The palette owns these reads now — it mounts only while open, so the queries exist only then.
 * `mockTables` lets a test drive the Tables section the way the `tables` prop used to.
 */
const mockTables = vi.hoisted(() => ({ current: [] as unknown[] }))

vi.mock('@/hooks/queries/tables', () => ({
  useTablesList: () => ({ data: mockTables.current }),
}))
vi.mock('@/hooks/queries/workspace-files', () => ({
  useWorkspaceFiles: () => ({ data: [] }),
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useKnowledgeBasesQuery: () => ({ data: [] }),
}))
vi.mock('@/hooks/queries/folders', () => ({
  useFolderMap: () => ({ data: {} }),
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

  it('toggles ask mode with Tab and hands the query to Sim on Enter', async () => {
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(<SearchModal open onOpenChange={onOpenChange} />)
    })

    await enterSearchQuery('plan our Slack launch week')
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search anything"]')
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      )
    })

    const askRow = document.querySelector<HTMLElement>('[cmdk-item]')
    expect(document.querySelectorAll('[cmdk-item]')).toHaveLength(1)
    expect(askRow?.textContent).toBe('New chat: plan our Slack launch week')
    expect(askRow?.getAttribute('aria-selected')).toBe('true')

    act(() => {
      document
        .querySelector<HTMLInputElement>('input[aria-label="Ask Sim"]')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        )
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockPush).toHaveBeenCalledWith('/workspace/workspace-1/home')
    expect(MothershipHandoffStorage.consume('workspace-1')).toEqual({
      message: 'plan our Slack launch week',
      contexts: [],
    })
  })

  it('returns to search results when Tab is pressed again in ask mode', async () => {
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

    await enterSearchQuery('rainbow')
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search anything"]')
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      )
    })
    expect(document.querySelector('[cmdk-item]')?.textContent).toBe('New chat: rainbow')

    act(() => {
      document
        .querySelector<HTMLInputElement>('input[aria-label="Ask Sim"]')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
        )
    })
    expect(document.querySelector('[cmdk-item]')?.textContent).toContain('Rainbow workflow')
  })

  it('puts the page itself first for an exact page-name query, then its contents', async () => {
    const logs = [
      {
        id: 'log-1',
        name: 'Billing sync',
        href: '/workspace/workspace-1/logs?executionId=e1',
        date: 'Aug 8, 1:00 PM',
      },
      {
        id: 'log-2',
        name: 'Onboarding',
        href: '/workspace/workspace-1/logs?executionId=e2',
        date: 'Aug 8, 2:00 PM',
      },
    ]
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} logs={logs} />)
    })

    await enterSearchQuery('Logs')
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map(
      (el) => el.textContent ?? ''
    )
    expect(rows[0]).toContain('Logs')
    expect(rows[1]).toContain('Billing sync')
    expect(rows[2]).toContain('Onboarding')
  })

  it('puts an exact-name block before its page and contents on the workflow editor', async () => {
    const Icon = () => null
    const original = { ...mockSearchState.data }
    mockSearchState.data = {
      ...mockSearchState.data,
      blocks: [{ id: 'logs', name: 'Logs', icon: Icon, bgColor: '#111', type: 'logs' }],
    }
    const logs = [
      {
        id: 'log-1',
        name: 'Billing sync',
        href: '/workspace/workspace-1/logs?executionId=e1',
        date: 'Aug 8, 1:00 PM',
      },
      {
        id: 'log-2',
        name: 'Onboarding',
        href: '/workspace/workspace-1/logs?executionId=e2',
        date: 'Aug 8, 2:00 PM',
      },
    ]
    try {
      await act(async () => {
        root.render(<SearchModal open onOpenChange={vi.fn()} pageContext='workflow' logs={logs} />)
      })

      await enterSearchQuery('Logs')
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]'))
      expect(rows.slice(0, 4).map((row) => row.textContent ?? '')).toEqual([
        'Logs',
        'Logs⇧⌘L',
        'Billing syncAug 8, 1:00 PM',
        'OnboardingAug 8, 2:00 PM',
      ])
    } finally {
      mockSearchState.data = original
    }
  })

  it('puts Create workflow first for the module-name query, then the workflows', async () => {
    const workflows = [
      { id: 'workflow-a', name: 'Alpha', href: '/workspace/workspace-1/w/workflow-a' },
      { id: 'workflow-b', name: 'Beta', href: '/workspace/workspace-1/w/workflow-b' },
    ]
    await act(async () => {
      root.render(
        <SearchModal
          open
          onOpenChange={vi.fn()}
          canEdit
          onCreateWorkflow={vi.fn()}
          workflows={workflows}
        />
      )
    })

    await enterSearchQuery('workflows')
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map(
      (el) => el.textContent ?? ''
    )
    expect(rows[0]).toContain('Create workflow')
    expect(rows[1]).toContain('Alpha')
    expect(rows[2]).toContain('Beta')
  })

  it('puts New chat first for the module-name query, then the chats', async () => {
    const chats = [
      { id: 'chat-a', name: 'Alpha', href: '/workspace/workspace-1/home?chatId=chat-a' },
      { id: 'chat-b', name: 'Beta', href: '/workspace/workspace-1/home?chatId=chat-b' },
    ]
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} chats={chats} />)
    })

    await enterSearchQuery('chats')
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map(
      (el) => el.textContent ?? ''
    )
    expect(rows[0]).toContain('New chat')
    expect(rows[1]).toContain('Alpha')
    expect(rows[2]).toContain('Beta')
  })

  it('shows an empty state when search has no results', async () => {
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} />)
    })

    await enterSearchQuery('explain quantum rainbows')

    expect(document.querySelectorAll('[cmdk-item]')).toHaveLength(0)
    expect(document.querySelector('[cmdk-empty]')?.textContent).toBe('No results found.')
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
        document
          .querySelector<HTMLInputElement>('input[aria-label="Search anything"]')
          ?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
          )
      })

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

  it('puts the Start Trigger first when the query is its exact name', async () => {
    const Icon = () => null
    const original = { ...mockSearchState.data }
    mockSearchState.data = {
      ...mockSearchState.data,
      triggers: [{ id: 'start', name: 'Start', icon: Icon, bgColor: '#111', type: 'start' }],
      toolOperations: [
        {
          id: 'browser_start_task',
          name: 'Start Task',
          serviceName: 'Browser',
          searchValue: 'browser start-task',
          icon: Icon,
          bgColor: '#611f69',
          blockType: 'browser',
          operationId: 'start_task',
        },
      ],
    }
    const workflows = [
      { id: 'workflow-start', name: 'Start', href: '/workspace/workspace-1/w/workflow-start' },
    ]

    try {
      await act(async () => {
        root.render(
          <SearchModal open onOpenChange={vi.fn()} pageContext='workflow' workflows={workflows} />
        )
      })

      await enterSearchQuery('start')
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map(
        (el) => el.textContent ?? ''
      )
      expect(rows[0]).toContain('Start Trigger')
      expect(rows.some((row) => row.includes('Start Task'))).toBe(true)
    } finally {
      mockSearchState.data = original
    }
  })

  it('keeps a block above its same-name trigger for the exact-name query', async () => {
    const Icon = () => null
    const original = { ...mockSearchState.data }
    mockSearchState.data = {
      ...mockSearchState.data,
      tools: [
        {
          id: 'gmail',
          name: 'Gmail',
          icon: Icon,
          bgColor: '#E8453C',
          type: 'gmail',
          searchValue: 'gmail gmail',
        },
      ],
      triggers: [{ id: 'gmail', name: 'Gmail', icon: Icon, bgColor: '#E8453C', type: 'gmail' }],
    }

    try {
      await act(async () => {
        root.render(<SearchModal open onOpenChange={vi.fn()} pageContext='workflow' />)
      })

      await enterSearchQuery('gmail')
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map(
        (el) => el.textContent ?? ''
      )
      expect(rows[0]).toContain('Gmail')
      expect(rows[0]).not.toContain('Gmail Trigger')
      expect(rows[1]).toContain('Gmail Trigger')
    } finally {
      mockSearchState.data = original
    }
  })

  it('ranks prefix-matched rows above actions that only contain the letter mid-word', async () => {
    const Icon = () => null
    const original = { ...mockSearchState.data }
    mockSearchState.data = {
      ...mockSearchState.data,
      tools: [
        {
          id: 'hex',
          name: 'Hex',
          icon: Icon,
          bgColor: '#111',
          type: 'hex',
          searchValue: 'hex hex',
        },
      ],
    }

    try {
      await act(async () => {
        root.render(<SearchModal open onOpenChange={vi.fn()} pageContext='workflow' />)
      })

      await enterSearchQuery('h')
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map(
        (el) => el.textContent ?? ''
      )
      expect(rows[0]).toContain('Hex')
      expect(rows.findIndex((row) => row.includes('New chat'))).toBeGreaterThan(0)
    } finally {
      mockSearchState.data = original
    }
  })

  it('puts the workflow verb actions first for their bare-verb queries', async () => {
    const Icon = () => null
    const original = { ...mockSearchState.data }
    mockSearchState.data = {
      ...mockSearchState.data,
      toolOperations: [
        {
          id: 'vercel_deploy',
          name: 'Deploy',
          serviceName: 'Vercel',
          searchValue: 'vercel deploy',
          icon: Icon,
          bgColor: '#000',
          blockType: 'vercel',
          operationId: 'deploy',
        },
        {
          id: 'sheets_copy',
          name: 'Copy',
          serviceName: 'Sheets',
          searchValue: 'sheets copy',
          icon: Icon,
          bgColor: '#0f9d58',
          blockType: 'sheets',
          operationId: 'copy',
        },
      ],
    }

    try {
      await act(async () => {
        root.render(<SearchModal open onOpenChange={vi.fn()} pageContext='workflow' canAdmin />)
      })

      await enterSearchQuery('deploy')
      let rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map(
        (el) => el.textContent ?? ''
      )
      expect(rows[0]).toContain('Deploy workflow')
      expect(rows.some((row) => row.includes('Vercel'))).toBe(true)

      await enterSearchQuery('copy')
      rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map(
        (el) => el.textContent ?? ''
      )
      expect(rows[0]).toContain('Copy workflow link')
      expect(rows.some((row) => row.includes('Sheets'))).toBe(true)
    } finally {
      mockSearchState.data = original
    }
  })

  it('browses every section uncapped', async () => {
    const Icon = () => null
    const workflows = Array.from({ length: 10 }, (_, index) => ({
      id: `workflow-${index}`,
      name: `Zeta ${index}`,
      href: `/workspace/workspace-1/w/workflow-${index}`,
    }))
    const integrations = Array.from({ length: 30 }, (_, index) => ({
      id: `catalog-${index}`,
      name: `Acme ${index}`,
      href: `/workspace/workspace-1/integrations/catalog-${index}`,
      icon: Icon,
      bgColor: '#111',
    }))

    await act(async () => {
      root.render(
        <SearchModal
          open
          onOpenChange={vi.fn()}
          integrations={integrations}
          workflows={workflows}
        />
      )
    })

    const rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map(
      (el) => el.textContent ?? ''
    )
    expect(rows.filter((row) => /Zeta \d/.test(row))).toHaveLength(10)
    expect(rows.filter((row) => /Acme \d/.test(row))).toHaveLength(30)
  })

  it('ranks a matched action above an exact-named entity from another section', async () => {
    const workflows = [
      { id: 'workflow-run', name: 'Run', href: '/workspace/workspace-1/w/workflow-run' },
    ]
    await act(async () => {
      root.render(
        <SearchModal open onOpenChange={vi.fn()} pageContext='workflow' workflows={workflows} />
      )
    })

    await enterSearchQuery('run')
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map(
      (el) => el.textContent ?? ''
    )
    expect(rows[0]).toContain('Run workflow')
    expect(rows.some((row) => row.includes('Run') && !row.includes('Run workflow'))).toBe(true)
  })

  it('orders canvas browse groups as Actions, Sim, building blocks, then the standard tail', async () => {
    const Icon = () => null
    const block = { id: 'agent', name: 'Agent', icon: Icon, bgColor: '#111', type: 'agent' }
    const original = { ...mockSearchState.data }
    mockSearchState.data = {
      ...mockSearchState.data,
      blocks: [block],
      triggers: [{ ...block, id: 'schedule', name: 'Schedule', type: 'schedule' }],
      tools: [{ ...block, id: 'slack', name: 'Slack', type: 'slack' }],
      toolOperations: [
        {
          id: 'slack_send_message',
          name: 'Send Message',
          serviceName: 'Slack',
          searchValue: 'slack send-message',
          icon: Icon,
          bgColor: '#611f69',
          blockType: 'slack',
          operationId: 'send_message',
        },
      ],
    }
    const workflows = [
      { id: 'workflow-a', name: 'Alpha workflow', href: '/workspace/workspace-1/w/workflow-a' },
    ]
    const integrations = [
      {
        id: 'slack-int',
        name: 'Slack',
        href: '/integrations/slack',
        icon: Icon,
        bgColor: '#611f69',
      },
    ]

    try {
      await act(async () => {
        root.render(
          <SearchModal
            open
            onOpenChange={vi.fn()}
            pageContext='workflow'
            workflows={workflows}
            integrations={integrations}
            connectedAccounts={integrations}
          />
        )
      })

      const headings = Array.from(
        document.querySelectorAll<HTMLElement>('[cmdk-group-heading]')
      ).map((el) => el.textContent)
      expect(headings.slice(0, 7)).toEqual([
        'Actions',
        'Sim',
        'Blocks',
        'Triggers',
        'Tools',
        'Pages',
        'Workflows',
      ])
      expect(headings).not.toContain('Tool operations')
      expect(headings).not.toContain('Integrations')
      expect(headings).not.toContain('Connected Integrations')
    } finally {
      mockSearchState.data = original
    }
  })

  it('hoists a module page’s actions and its entity section directly under the Sim group', async () => {
    mockTables.current = [{ id: 'table-1', name: 'Leads', folderId: null }]
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} pageContext='tables' canEdit />)
    })

    const headings = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-group-heading]')).map(
      (el) => el.textContent
    )
    expect(headings.slice(0, 4)).toEqual(['Actions', 'Sim', 'Tables', 'Pages'])
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

  it('re-anchors selection to the first row after the re-ranked results commit', async () => {
    const workflows = [
      { id: 'workflow-1', name: 'Funnel', href: '/workspace/workspace-1/w/workflow-1' },
      { id: 'workflow-2', name: 'Funnel two', href: '/workspace/workspace-1/w/workflow-2' },
      { id: 'workflow-3', name: 'Function alpha', href: '/workspace/workspace-1/w/workflow-3' },
    ]
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} workflows={workflows} />)
    })

    const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]'))

    await enterSearchQuery('fun')
    expect(rows()[0]?.textContent).toContain('Funnel')
    expect(rows()[0]?.getAttribute('aria-selected')).toBe('true')

    await enterSearchQuery('func')
    expect(rows()).toHaveLength(1)
    expect(rows()[0]?.textContent).toContain('Function alpha')
    expect(rows()[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it('unmounts while closed and reopens with a blank query', async () => {
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} />)
    })
    await enterSearchQuery('previous search')

    act(() => {
      document
        .querySelector<HTMLInputElement>('input[aria-label="Search anything"]')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
        )
    })
    expect(document.querySelector('input[aria-label="Ask Sim"]')).not.toBeNull()

    await act(async () => {
      root.render(<SearchModal open={false} onOpenChange={vi.fn()} />)
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelectorAll('[cmdk-item]')).toHaveLength(0)

    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} />)
    })
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search anything"]')
    expect(input?.value).toBe('')
    expect(document.querySelector('input[aria-label="Ask Sim"]')).toBeNull()
  })

  it('hides tool operations in browse but keeps them searchable', async () => {
    const Icon = () => null
    const original = { ...mockSearchState.data }
    mockSearchState.data = {
      ...mockSearchState.data,
      toolOperations: Array.from({ length: 75 }, (_, index) => ({
        id: `service_operation_${index}`,
        name: `Operation ${index}`,
        serviceName: 'Service',
        searchValue: `service operation-${index}`,
        icon: Icon,
        bgColor: '#111',
        blockType: 'service',
        operationId: `operation_${index}`,
      })),
    }

    try {
      await act(async () => {
        root.render(<SearchModal open onOpenChange={vi.fn()} pageContext='workflow' />)
      })

      const browseRows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).filter(
        (row) => row.textContent?.includes('Operation')
      )
      expect(browseRows).toHaveLength(0)

      await enterSearchQuery('Operation')
      expect(document.querySelectorAll('[cmdk-item]')).toHaveLength(50)

      await enterSearchQuery('Operation 74')
      const exactRows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]'))
      expect(exactRows.some((row) => row.textContent?.includes('Operation 74'))).toBe(true)
    } finally {
      mockSearchState.data = original
    }
  })

  it('does not offer deploy to workflow users without admin access', async () => {
    await act(async () => {
      root.render(
        <SearchModal open onOpenChange={vi.fn()} pageContext='workflow' canEdit canAdmin={false} />
      )
    })

    expect(document.body.textContent).not.toContain('Deploy workflow')

    await act(async () => {
      root.render(
        <SearchModal open onOpenChange={vi.fn()} pageContext='workflow' canEdit canAdmin />
      )
    })
    expect(document.body.textContent).toContain('Deploy workflow')
  })

  it('does not duplicate the Trigger suffix', async () => {
    const Icon = () => null
    const original = { ...mockSearchState.data }
    mockSearchState.data = {
      ...mockSearchState.data,
      triggers: [
        {
          id: 'generic_webhook',
          name: 'Webhook Trigger',
          icon: Icon,
          bgColor: '#111',
          type: 'generic_webhook',
        },
      ],
    }

    try {
      await act(async () => {
        root.render(<SearchModal open onOpenChange={vi.fn()} pageContext='workflow' />)
      })
      expect(document.body.textContent).toContain('Webhook Trigger')
      expect(document.body.textContent).not.toContain('Webhook Trigger Trigger')
    } finally {
      mockSearchState.data = original
    }
  })

  it('accents a first-party trigger by its canvas role, not its catalog color', async () => {
    const Icon = () => null
    const original = { ...mockSearchState.data }
    /*
     * The palette reads the accent from the block's category, so the row's
     * appearance is only meaningful against a registry that reports one — the
     * shared mock omits it.
     */
    const mockedGetBlock = vi.mocked(getBlock)
    const originalGetBlock = mockedGetBlock.getMockImplementation()
    mockedGetBlock.mockImplementation(
      (type: string) => ({ category: type === 'slack' ? 'tools' : 'triggers', icon: Icon }) as never
    )
    mockSearchState.data = {
      ...mockSearchState.data,
      triggers: [
        {
          id: 'generic_webhook',
          name: 'Webhook Trigger',
          icon: Icon,
          bgColor: '#10B981',
          type: 'generic_webhook',
        },
        {
          id: 'slack',
          name: 'Slack',
          icon: Icon,
          bgColor: '#611f69',
          type: 'slack',
        },
      ],
    }

    try {
      await act(async () => {
        root.render(<SearchModal open onOpenChange={vi.fn()} pageContext='workflow' />)
      })

      expect(document.querySelector('[data-workflow-type-icon="generic_webhook"]')).not.toBeNull()
      // A third-party trigger keeps its brand tile, exactly as the canvas paints it.
      expect(document.querySelector('[data-workflow-type-icon="slack"]')).toBeNull()
    } finally {
      mockSearchState.data = original
      if (originalGetBlock) mockedGetBlock.mockImplementation(originalGetBlock)
    }
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
        document
          .querySelector<HTMLInputElement>('input[aria-label="Search anything"]')
          ?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
          )
      })

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
