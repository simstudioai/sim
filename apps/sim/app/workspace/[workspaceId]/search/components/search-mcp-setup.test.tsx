/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.fixture.test' }))

import { SearchMcpSetup } from '@/app/workspace/[workspaceId]/search/components/search-mcp-setup'

describe('Search MCP setup', () => {
  let root: Root | undefined
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    container?.remove()
    vi.unstubAllGlobals()
  })

  it('opens the platform modal with the workspace endpoint, API-key settings link, and correct access semantics', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(
        <NuqsTestingAdapter hasMemory>
          <SearchMcpSetup workspaceId='workspace-1' />
        </NuqsTestingAdapter>
      )
    )
    const setup = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Set up'
    )
    expect(setup).toBeDefined()
    await act(async () => setup?.click())
    const modal = document.querySelector('[role="dialog"]')
    expect(modal).not.toBeNull()
    expect(
      modal?.querySelector<HTMLInputElement>(
        'input[value="https://sim.fixture.test/api/mcp/search/workspace-1"]'
      )?.readOnly
    ).toBe(true)
    expect(modal?.querySelector('[aria-label="Copy MCP server URL"]')).not.toBeNull()
    expect(modal?.querySelector('a')?.getAttribute('href')).toBe(
      '/workspace/workspace-1/settings/apikeys?search-setup=mcp'
    )
    expect(modal?.textContent).toContain('personal key uses your document access')
    expect(modal?.textContent).toContain(
      'workspace key can only read documents shared with the whole workspace'
    )
    expect(modal?.textContent).toContain('Streamable HTTP')
    const close = Array.from(modal?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'Close'
    )
    expect(close).toBeDefined()
    await act(async () => close?.click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
