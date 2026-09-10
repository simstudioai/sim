/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { SearchSourceStatus } from '@/app/workspace/[workspaceId]/search/components/search-source-status'

const { push, host } = vi.hoisted(() => ({ push: vi.fn(), host: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useOptionalWorkspaceHostContext: host,
}))
vi.mock('@/connectors/registry', () => ({ CONNECTOR_META_REGISTRY: {} }))
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section', () => ({
  ConnectorsSection: () => null,
}))
vi.mock('@sim/emcn', () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>
  return {
    ChipModal: Container,
    ChipModalBody: Container,
    ChipModalField: Container,
    ChipModalHeader: Container,
    ChipModalFooter: ({
      primaryAction,
    }: {
      primaryAction: { label: string; onClick: () => void }
    }) => (
      <button type='button' onClick={primaryAction.onClick}>
        {primaryAction.label}
      </button>
    ),
  }
})

describe('SearchSourceStatus navigation', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    root = createRoot(container)
    push.mockClear()
    host.mockReturnValue(null)
  })

  afterEach(() => act(() => root.unmount()))

  function render(scope: ResourceScope) {
    act(() =>
      root.render(
        <SearchSourceStatus
          scope={scope}
          knowledgeBaseId='kb-1'
          connectorType='test'
          connectors={[]}
          isLoading={false}
          onClose={vi.fn()}
        />
      )
    )
  }

  it('opens the owning organization search route', () => {
    render({ kind: 'organization', organizationId: 'org-1' })
    act(() => container.querySelector('button')?.click())
    expect(push).toHaveBeenCalledWith('/o/org-1/search')
  })

  it.each([
    ['workspace-1', true, true, true, true],
    ['workspace-1', false, true, true, false],
    ['workspace-1', true, false, true, false],
    ['workspace-1', true, true, false, false],
    ['another-workspace', true, true, true, false],
  ])(
    'gates workspace entry using routed host access: %s %s %s %s',
    (id, isMember, organizationSearch, knowledgeMemberAccess, visible) => {
      host.mockReturnValue({
        workspace: { id },
        hostOrganizationId: 'org-1',
        viewer: { isHostOrganizationMember: isMember },
        features: { organizationSearch, knowledgeMemberAccess },
      })
      render({ kind: 'workspace', workspaceId: 'workspace-1' })
      const button = container.querySelector('button')
      expect(Boolean(button)).toBe(visible)
      if (visible) {
        act(() => button?.click())
        expect(push).toHaveBeenCalledWith('/o/org-1/search')
      }
    }
  )
})
