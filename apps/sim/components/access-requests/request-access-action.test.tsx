/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestAccessAction } from '@/components/access-requests/request-access-action'
import type { AccessRequestTarget } from '@/lib/api/contracts/access-requests'

vi.mock('@/hooks/queries/access-requests', () => ({
  useCreateAccessRequest: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))

const scope = { kind: 'workspace', workspaceId: 'workspace' } as const
const tables = { kind: 'feature', configKey: 'hideTablesTab' } as const

describe('request form lifecycle', () => {
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
  })
  const render = (pendingRequestId?: string, target: AccessRequestTarget = tables) =>
    act(() =>
      root.render(
        <RequestAccessAction
          scope={scope}
          target={target}
          label='Tables'
          pendingRequestId={pendingRequestId}
        />
      )
    )
  const open = () => act(() => container.querySelector('button')!.click())

  it('does not reopen a dismissed form when an external pending request disappears', () => {
    render()
    open()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    render('pending-request')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('a')?.textContent).toContain('View request')
    render()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('closes the previous form when its target changes', () => {
    render()
    open()
    render(undefined, { kind: 'feature', configKey: 'hideKnowledgeBaseTab' })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
