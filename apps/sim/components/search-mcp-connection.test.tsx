/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchMcpConnection } from '@/components/search-mcp-connection'

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
    vi.unstubAllGlobals()
  })

  async function render(endpoint = ENDPOINT) {
    await act(async () => root.render(<SearchMcpConnection endpoint={endpoint} flush />))
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

  it('starts with a native Claude URL and explains the team-owner prerequisite', async () => {
    await render()
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe(ENDPOINT)
    expect(container.textContent).toContain('Claude web or Desktop')
    expect(container.textContent).toContain('an owner adds the connector first')
    expect(container.textContent).not.toContain('API key')
    const copyButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Copy MCP server URL"]'
    )!
    await act(async () => copyButton.click())
    expect(writeText).toHaveBeenCalledExactlyOnceWith(ENDPOINT)
  })

  it('provides Codex URL registration and browser login without a bearer token', async () => {
    await render()
    await selectClient('Codex')
    const config = await copyConfiguration()
    expect(config).toBe(`codex mcp add sim-search --url '${ENDPOINT}'`)
    expect(config).not.toContain('mcp login')
    expect(config).not.toContain('token')
    expect(container.textContent).toContain('sign in to Sim in the browser')
    expect(container.textContent).toContain('To reconnect, run codex mcp login sim-search')
  })

  it('uses native HTTP transport for Claude Code and directs authentication to /mcp', async () => {
    await render()
    await selectClient('Claude Code')
    expect(await copyConfiguration()).toBe(
      `claude mcp add --transport http sim-search '${ENDPOINT}'`
    )
    expect(container.textContent).toContain('open /mcp in Claude Code')
  })

  it('uses native URL-only Cursor configuration and replaces it when switching clients', async () => {
    await render()
    await selectClient('Cursor')
    expect(JSON.parse(await copyConfiguration())).toEqual({
      mcpServers: { 'sim-search': { url: ENDPOINT } },
    })
    expect(container.textContent).toContain('~/.cursor/mcp.json')
    await selectClient('Claude')
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe(ENDPOINT)
    expect(container.textContent).not.toContain('Copy configuration')
    expect(container.textContent).not.toContain('mcpServers')
  })

  it('quotes a shell metacharacter in the copied endpoint as a literal', async () => {
    await render("https://sim.fixture.test/api/mcp/search/workspace'$(example)")
    await selectClient('Claude Code')
    expect(await copyConfiguration()).toBe(
      "claude mcp add --transport http sim-search 'https://sim.fixture.test/api/mcp/search/workspace'\\''$(example)'"
    )
  })

  it('provides a client-independent URL and the transport and authentication requirements', async () => {
    await render()
    await selectClient('Other')
    expect(await copyConfiguration()).toBe(ENDPOINT)
    expect(container.textContent).toContain('remote MCP with OAuth')
    expect(container.textContent).toContain('Streamable HTTP')
    expect(container.textContent).not.toContain('mcpServers')
  })

  it.each(['Claude', 'Codex', 'Claude Code', 'Cursor', 'Other'])(
    'copies the current resource after the endpoint changes for %s',
    async (client) => {
      await render()
      await selectClient(client)
      await copyConfiguration()
      const nextEndpoint = 'https://sim.fixture.test/api/mcp/search/workspace-2'
      await render(nextEndpoint)
      const value = await copyConfiguration()
      expect(value).toContain(nextEndpoint)
      expect(value).not.toContain(ENDPOINT)
      expect(container.querySelector('[aria-label^="MCP app: "]')?.textContent).toContain(client)
    }
  )

  it('allows a failed clipboard copy to be retried', async () => {
    await render()
    await selectClient('Cursor')
    writeText.mockRejectedValueOnce(new Error('Clipboard is unavailable'))
    await copyConfiguration()
    expect(container.querySelector('button[disabled]')).toBeNull()
    expect(JSON.parse(await copyConfiguration())).toEqual({
      mcpServers: { 'sim-search': { url: ENDPOINT } },
    })
    expect(writeText).toHaveBeenCalledTimes(2)
  })
})
