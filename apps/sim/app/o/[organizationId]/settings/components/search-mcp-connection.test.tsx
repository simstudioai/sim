/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchMcpConnection } from '@/app/o/[organizationId]/settings/components/search-mcp-connection'

const ENDPOINT = 'https://sim.fixture.test/api/mcp/search/organizations/org-1'

describe('Search MCP client connection', () => {
  let root: Root
  let container: HTMLDivElement
  const writeText = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    writeText.mockReset().mockResolvedValue(undefined)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function render(endpoint = ENDPOINT) {
    await act(async () => root.render(<SearchMcpConnection endpoint={endpoint} />))
  }

  async function selectClient(label: string) {
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label^="MCP app: "]')!
    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (element) => element.textContent?.trim() === label
    )
    expect(item, `Expected the ${label} client`).toBeDefined()
    await act(async () => item!.click())
    expect(trigger.getAttribute('aria-label')).toBe(`MCP app: ${label}`)
  }

  async function copyConfiguration() {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (element) =>
        /^Copy (configuration|command|MCP server URL)$/.test(
          element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''
        )
    )
    expect(button).toBeDefined()
    await act(async () => button!.click())
    return writeText.mock.lastCall?.[0] as string
  }

  it('quotes a shell metacharacter in the copied endpoint as a literal', async () => {
    await render("https://sim.fixture.test/api/mcp/search/organizations/org'$(example)")
    await selectClient('Claude Code')
    expect(await copyConfiguration()).toBe(
      "claude mcp add --transport http sim-search 'https://sim.fixture.test/api/mcp/search/organizations/org'\\''$(example)'"
    )
  })
})
