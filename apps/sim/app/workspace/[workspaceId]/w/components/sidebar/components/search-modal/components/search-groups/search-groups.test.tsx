/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { Command } from 'cmdk'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchEntryGroup } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/search-groups/search-groups'
import type {
  SearchEntry,
  SearchEntryHandlers,
  WorkspaceItem,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'

function TestIcon() {
  return <svg />
}

const handlers: SearchEntryHandlers = {
  onSelectAction: vi.fn(),
  onSelectConnectedAccount: vi.fn(),
  onSelectIntegration: vi.fn(),
  onSelectChat: vi.fn(),
  onSelectWorkflow: vi.fn(),
  onSelectTable: vi.fn(),
  onSelectFile: vi.fn(),
  onSelectKnowledgeBase: vi.fn(),
  onSelectLog: vi.fn(),
  onSelectWorkspace: vi.fn(),
  onSelectPage: vi.fn(),
}

const actionEntry: SearchEntry = {
  section: 'actions',
  score: 100,
  item: {
    id: 'run-workflow',
    name: 'Run workflow',
    icon: TestIcon,
    context: 'workflow',
    run: vi.fn(),
  },
}

const workspaceItems: WorkspaceItem[] = [
  {
    id: 'workspace-acme',
    name: 'Acme',
    href: '/workspace/workspace-acme/w',
    logoUrl: 'https://cdn.example.com/acme.png',
  },
  {
    id: 'workspace-beta',
    name: 'Beta Workspace',
    href: '/workspace/workspace-beta/w',
  },
]

const workspaceEntries: SearchEntry[] = workspaceItems.map((item, index) => ({
  section: 'workspaces',
  score: 100 - index,
  item,
}))

describe('SearchEntryGroup', () => {
  let container: HTMLDivElement
  let root: Root
  let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
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
    vi.unstubAllGlobals()
    if (originalScrollIntoView) {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('renders flat search results without passing a null group heading to cmdk', () => {
    act(() => {
      root.render(
        <Command>
          <Command.List>
            <SearchEntryGroup variant='results' entries={[actionEntry]} handlers={handlers} />
          </Command.List>
        </Command>
      )
    })

    expect(container.textContent).toContain('Run workflow')
    expect(container.querySelector('[cmdk-group-heading]')).toBeNull()
    expect(container.querySelector('button[aria-label*="favorites"]')).toBeNull()
  })

  it('renders workspace logos and initial fallbacks in workspace results', () => {
    act(() => {
      root.render(
        <Command>
          <Command.List>
            <SearchEntryGroup variant='results' entries={workspaceEntries} handlers={handlers} />
          </Command.List>
        </Command>
      )
    })

    const logo = container.querySelector<HTMLImageElement>('img[data-slot="workspace-icon"]')
    const fallback = container.querySelector('div[data-slot="workspace-icon"]')
    expect(logo?.src).toBe('https://cdn.example.com/acme.png')
    expect(logo?.alt).toBe('')
    expect(fallback?.textContent).toBe('B')
  })

  it('renders workspace icons in the default workspace section', () => {
    act(() => {
      root.render(
        <Command>
          <Command.List>
            <SearchEntryGroup
              variant='section'
              heading='Workspaces'
              entries={workspaceEntries}
              handlers={handlers}
            />
          </Command.List>
        </Command>
      )
    })

    expect(container.querySelector('img[data-slot="workspace-icon"]')).not.toBeNull()
    expect(container.querySelector('div[data-slot="workspace-icon"]')?.textContent).toBe('B')
  })
})
