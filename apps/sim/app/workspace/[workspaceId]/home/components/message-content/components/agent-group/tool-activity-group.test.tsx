/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityStatus } from '@/components/ui/activity-status'
import { ToolActivityGroup } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-activity-group'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import type { ToolCallData } from '@/app/workspace/[workspaceId]/home/types'

const executingSearch: ToolCallData = {
  id: 'search-1',
  toolName: 'search_workspace',
  displayTitle: 'Searching workspace',
  status: 'executing',
}

const completedSearch: ToolCallData = {
  ...executingSearch,
  status: 'success',
  result: {
    success: true,
    output: {
      success: true,
      data: {
        results: [
          {
            citationId: 'document:guide',
            citationUrl: 'https://example.test/guide',
            documentName: 'Guide',
          },
        ],
      },
    },
  },
}

function TestToolCall({ displayTitle, renderStatus }: ToolCallItemProps) {
  const status = { label: displayTitle, activeLabel: displayTitle, isActive: false, icon: null }
  return renderStatus ? renderStatus(status) : <ActivityStatus {...status} />
}

describe('ToolActivityGroup search disclosure', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(tool: ToolCallData, isLive: boolean) {
    act(() =>
      root.render(
        <ToolActivityGroup tools={[tool]} isLive={isLive} ToolCallComponent={TestToolCall} />
      )
    )
  }

  function disclosure() {
    const button = container.querySelector<HTMLElement>('[role="button"][aria-expanded]')
    if (!button) throw new Error('Expected a search activity disclosure')
    return button
  }

  it('opens when live results arrive, closes for the answer, and respects manual choices', () => {
    render(executingSearch, true)
    expect(container.querySelector('[role="button"][aria-expanded]')).toBeNull()

    render(completedSearch, true)
    expect(disclosure().getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('a[href="https://example.test/guide"]')).not.toBeNull()

    render(completedSearch, false)
    expect(disclosure().getAttribute('aria-expanded')).toBe('false')

    act(() => disclosure().click())
    expect(disclosure().getAttribute('aria-expanded')).toBe('true')
    render(completedSearch, false)
    expect(disclosure().getAttribute('aria-expanded')).toBe('true')
    render(completedSearch, true)
    expect(disclosure().getAttribute('aria-expanded')).toBe('true')

    act(() => disclosure().click())
    render(completedSearch, false)
    render(completedSearch, true)
    expect(disclosure().getAttribute('aria-expanded')).toBe('false')
  })
})
