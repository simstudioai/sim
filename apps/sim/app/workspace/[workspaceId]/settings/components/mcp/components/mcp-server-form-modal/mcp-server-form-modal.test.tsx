/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { clearTestResult } = vi.hoisted(() => ({ clearTestResult: vi.fn() }))

vi.mock('@/hooks/queries/mcp', () => ({
  useMcpServerTest: () => ({
    testResult: null,
    isTestingConnection: false,
    testConnection: vi.fn(),
    clearTestResult,
  }),
}))

import { McpServerFormModal } from '@/app/workspace/[workspaceId]/settings/components/mcp/components/mcp-server-form-modal/mcp-server-form-modal'

describe('McpServerFormModal dirty state', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    clearTestResult.mockReset()
  })

  it('reports edits only while the embedded edit form is open', () => {
    const onDirtyChange = vi.fn()
    const renderModal = (open: boolean) => {
      act(() => {
        root.render(
          <McpServerFormModal
            open={open}
            onOpenChange={vi.fn()}
            onDirtyChange={onDirtyChange}
            mode='edit'
            initialData={{
              name: 'DeepWiki',
              transport: 'streamable-http',
              url: 'https://mcp.deepwiki.com/mcp',
              timeout: 30000,
              headers: [{ key: '', value: '' }],
            }}
            onSubmit={vi.fn()}
            workspaceId='workspace-1'
            allowedMcpDomains={null}
          />
        )
      })
    }

    renderModal(true)
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)

    const nameInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="e.g., My MCP Server"]'
    )
    if (!nameInput) throw new Error('MCP server name input was not rendered')

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(nameInput, 'Renamed server')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    renderModal(false)
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })
})
