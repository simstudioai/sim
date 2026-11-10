/**
 * @vitest-environment jsdom
 *
 * A server's tools are a read of their own. Failure modes: discovery still pending reading as "No
 * tools available", and a failed discovery reading the same way with no Retry.
 */
import { act } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { McpServerDetail } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/mcp/mcp-server-detail'
import type { McpServer } from '@/platform/lib/data/mcp'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  container = document.createElement('div')
  container.setAttribute('data-emcn', '')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const server = {
  id: 'srv',
  name: 'Server',
  url: 'https://mcp.example',
  transport: 'streamable-http',
  authType: 'none',
  connectionStatus: 'connected',
  enabled: true,
} as unknown as McpServer

function render(
  toolsState: { isLoading: boolean; isFetching: boolean; error: Error | null },
  onRetryTools = () => undefined
) {
  act(() =>
    root.render(
      <McpServerDetail
        server={server}
        servers={[server]}
        discoveredTools={[]}
        storedTools={[]}
        toolsState={toolsState}
        onRetryTools={onRetryTools}
        canEdit={false}
        authorizing={false}
        deleting={false}
        refresh={{ label: 'Refresh', disabled: false }}
        onBack={() => undefined}
        onRefresh={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onAuthorize={() => undefined}
      />
    )
  )
}

it('paints no empty state while the tools are still being discovered', () => {
  render({ isLoading: true, isFetching: true, error: null })
  expect(container.textContent).not.toContain('No tools available')
})

it('shows a failed discovery with Retry rather than as no tools', async () => {
  const retry = vi.fn()
  render({ isLoading: false, isFetching: false, error: new Error('timeout') }, retry)
  expect(container.textContent).not.toContain('No tools available')
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')
  await act(async () => button?.click())
  expect(retry).toHaveBeenCalled()
})
