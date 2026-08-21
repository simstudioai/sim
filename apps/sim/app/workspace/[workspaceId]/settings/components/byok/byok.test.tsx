/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  scope: { current: 'workspace' as 'workspace' | 'organization' },
  setScope: vi.fn(),
  hostContext: {
    current: {
      hostOrganizationId: 'org-1' as string | null,
      viewer: { isHostOrganizationAdmin: true },
    },
  },
  canManageWorkspace: { current: true },
  organizationResult: {
    current: {
      data: {
        keys: [
          {
            id: 'org-key-id',
            providerId: 'openai',
            name: 'Sensitive organization key',
            maskedKey: 'sk-org-secret',
          },
        ],
        entitled: true,
      },
      isLoading: false,
    },
  },
  inheritedStatusError: { current: false },
  useOrganizationBYOKKeys: vi.fn(),
  mutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))

vi.mock('nuqs', () => ({
  useQueryState: () => [
    mocks.scope.current,
    (scope: 'workspace' | 'organization') => {
      mocks.scope.current = scope
      mocks.setScope(scope)
    },
  ],
}))

vi.mock('@sim/emcn', () => ({
  ChipTag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/settings/navigation', () => ({
  canMutateWorkspaceSettingsSection: () => mocks.canManageWorkspace.current,
}))

vi.mock('@/lib/core/config/env-flags', () => ({ isHosted: true }))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useWorkspaceHostContext: () => mocks.hostContext.current,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({}),
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/use-settings-search', () => ({
  useSettingsSearch: () => ['', vi.fn()],
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({
    children,
    actions,
  }: {
    children: ReactNode
    actions?: Array<{
      id: string
      text: string
      active?: boolean
      disabled?: boolean
      onSelect: () => void
    }>
  }) => (
    <main>
      <header>
        {(actions ?? []).map((action) => (
          <button
            key={action.id}
            type='button'
            aria-pressed={action.active}
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            {action.text}
          </button>
        ))}
      </header>
      {children}
    </main>
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/byok/byok-key-manager', () => ({
  BYOKKeyManager: ({
    providers,
    keysByProvider,
    capabilities,
    description,
    keyUsageDescription,
  }: {
    providers: Array<{ id: string; name: string; badge?: ReactNode }>
    keysByProvider: ReadonlyMap<
      string,
      Array<{ id: string; name: string | null; maskedKey: string }>
    >
    capabilities: { add: boolean; update: boolean; delete: boolean }
    description?: string
    keyUsageDescription?: string
  }) => (
    <section
      aria-label='BYOK manager'
      data-capabilities={`${capabilities.add}:${capabilities.update}:${capabilities.delete}`}
    >
      {description && <p>{description}</p>}
      {keyUsageDescription && <p>{keyUsageDescription}</p>}
      {providers.map((provider) => (
        <div key={provider.id}>
          {provider.name}
          {provider.badge}
        </div>
      ))}
      {[...keysByProvider.values()].flat().map((key) => (
        <div key={key.id}>{`${key.name ?? 'Unnamed key'} ${key.maskedKey}`}</div>
      ))}
    </section>
  ),
}))

vi.mock('@/hooks/queries/byok-keys', () => ({
  useBYOKKeys: () => ({
    data: {
      keys: [
        {
          id: 'workspace-key-id',
          providerId: 'openai',
          name: 'Workspace key',
          maskedKey: 'sk-workspace',
        },
      ],
    },
    isLoading: false,
  }),
  useOrganizationBYOKKeys: (...args: unknown[]) => {
    mocks.useOrganizationBYOKKeys(...args)
    return mocks.organizationResult.current
  },
  useInheritedBYOKStatus: () => ({
    data: { inheritedProviderIds: ['anthropic'] },
    isError: mocks.inheritedStatusError.current,
  }),
  useUpsertBYOKKey: mocks.mutation,
  useDeleteBYOKKey: mocks.mutation,
  useUpsertOrganizationBYOKKey: mocks.mutation,
  useDeleteOrganizationBYOKKey: mocks.mutation,
}))

import { BYOK } from '@/app/workspace/[workspaceId]/settings/components/byok/byok'

describe('BYOK scope access', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scope.current = 'workspace'
    mocks.hostContext.current.hostOrganizationId = 'org-1'
    mocks.hostContext.current.viewer.isHostOrganizationAdmin = true
    mocks.canManageWorkspace.current = true
    mocks.organizationResult.current.data.entitled = true
    mocks.inheritedStatusError.current = false

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<BYOK />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('switches an organization admin safely and falls back without rendering cached org metadata', () => {
    expect(container.textContent).toContain('Workspace key sk-workspace')
    expect(container.textContent).toContain('Inherited from organization')
    expect(mocks.useOrganizationBYOKKeys).toHaveBeenLastCalledWith(undefined, {
      enabled: false,
    })

    const organizationAction = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Organization'
    )
    expect(organizationAction).toBeDefined()

    act(() => {
      organizationAction?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      root.render(<BYOK />)
    })

    expect(mocks.setScope).toHaveBeenCalledWith('organization')
    expect(mocks.useOrganizationBYOKKeys).toHaveBeenLastCalledWith('org-1', { enabled: true })
    expect(container.textContent).toContain('Sensitive organization key sk-org-secret')
    expect(container.querySelector('[aria-label="BYOK manager"]')).toHaveAttribute(
      'data-capabilities',
      'true:true:true'
    )
    expect(container.textContent).toContain('every current and future workspace')
    expect(container.textContent).toContain('untrusted Pi sandbox')
    expect(container.textContent).toContain('Pi search still requires an explicit block key')

    mocks.organizationResult.current.data.entitled = false
    act(() => root.render(<BYOK />))
    expect(container.querySelector('[aria-label="BYOK manager"]')).toHaveAttribute(
      'data-capabilities',
      'false:false:true'
    )
    expect(container.textContent).toContain(
      'An active organization plan is required to add or update them'
    )

    mocks.hostContext.current.viewer.isHostOrganizationAdmin = false
    act(() => root.render(<BYOK />))

    expect(mocks.scope.current).toBe('organization')
    expect(mocks.useOrganizationBYOKKeys).toHaveBeenLastCalledWith(undefined, {
      enabled: false,
    })
    expect(container.textContent).not.toContain('Sensitive organization key')
    expect(container.textContent).not.toContain('sk-org-secret')
    expect(container.textContent).toContain('Workspace key sk-workspace')
    expect(container.textContent).toContain('Inherited from organization')
    expect(container.querySelector('[aria-label="BYOK manager"]')).toHaveAttribute(
      'data-capabilities',
      'true:true:true'
    )
    expect([...container.querySelectorAll('button')]).toHaveLength(0)

    mocks.inheritedStatusError.current = true
    act(() => root.render(<BYOK />))

    expect(container.textContent).toContain(
      'Inherited key status unavailable. Refresh to try again.'
    )
    expect(container.textContent).not.toContain('Inherited from organization')
    expect(container.querySelector('[aria-label="BYOK manager"]')).toHaveAttribute(
      'data-capabilities',
      'true:true:true'
    )
  })
})
