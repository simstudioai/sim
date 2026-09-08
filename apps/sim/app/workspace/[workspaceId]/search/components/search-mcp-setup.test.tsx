/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.fixture.test' }))

import { SearchMcpSetup } from '@/app/workspace/[workspaceId]/search/components/search-mcp-setup'

function getButton(label: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent?.trim() === label
  )
  expect(button, `Expected the ${label} button`).toBeDefined()
  return button!
}

describe('Search MCP setup', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('opens OAuth setup with the workspace URL and no API-key generation step', async () => {
    await act(async () => root.render(<SearchMcpSetup workspaceId='workspace-1' />))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => getButton('Set up').click())

    const dialog = document.querySelector('[role="dialog"]')!
    const url = dialog.querySelector<HTMLInputElement>('input')!
    expect(url.readOnly).toBe(true)
    expect(url.value).toBe('https://sim.fixture.test/api/mcp/search/workspace-1')
    expect(dialog.querySelector('[aria-label="Copy MCP server URL"]')).not.toBeNull()
    expect(dialog.textContent).toContain('sign in to Sim')
    expect(dialog.textContent).not.toContain('API key')
    expect(dialog.textContent).not.toContain('Authorization header')
    expect(dialog.querySelector('[aria-label^="MCP app: "]')).not.toBeNull()

    await act(async () => getButton('Close').click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('updates the URL when the active workspace changes without retaining the previous scope', async () => {
    await act(async () => root.render(<SearchMcpSetup workspaceId='workspace-1' />))
    await act(async () => getButton('Set up').click())
    await act(async () => root.render(<SearchMcpSetup workspaceId='workspace-2' />))
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')?.value).toBe(
      'https://sim.fixture.test/api/mcp/search/workspace-2'
    )
    expect(document.body.innerHTML).not.toContain('/search/workspace-1')
  })
})
