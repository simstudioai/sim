/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseWorkspaceHostContextQuery } = vi.hoisted(() => ({
  mockUseWorkspaceHostContextQuery: vi.fn(),
}))

vi.mock('@/hooks/queries/workspace-host', () => ({
  useWorkspaceHostContextQuery: mockUseWorkspaceHostContextQuery,
}))

vi.mock('@/app/workspace/[workspaceId]/components/workspace-access-denied', () => ({
  WorkspaceAccessDenied: () => <output data-testid='denied' />,
}))

import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import {
  getDeploymentShape,
  resetDeploymentShape,
  resolveDeploymentShape,
} from '@/lib/core/config/deployment-shape'
import {
  useWorkspaceHostContext,
  WorkspaceHostProvider,
} from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HOST_CONTEXT: WorkspaceHostContext = {
  workspace: {
    id: 'workspace-1',
    name: 'Workspace',
    workspaceMode: 'organization',
    billedAccountUserId: 'owner-1',
  },
  hostOrganizationId: 'org-1',
  ownerBilling: {
    plan: 'team',
    status: 'active',
    isPaid: true,
    isPro: false,
    isTeam: true,
    isEnterprise: false,
    isOrgScoped: true,
    organizationId: 'org-1',
    billingInterval: 'month',
    billingBlocked: false,
    billingBlockedReason: null,
  },
  viewer: {
    permission: 'admin',
    isHostOrganizationMember: true,
    isHostOrganizationAdmin: true,
  },
  deployment: {
    ...resolveDeploymentShape(),
    hosted: true,
    billingEnabled: true,
  },
}

/** Reads the getter during render, the way block conditions do. */
function GetterReader() {
  return <output data-testid='getter'>{String(getDeploymentShape().hosted)}</output>
}

function ContextReader() {
  const { deployment } = useWorkspaceHostContext()
  return <output data-testid='context'>{String(deployment?.billingEnabled)}</output>
}

let host: HTMLDivElement
let root: Root

function renderProvider(initialContext: WorkspaceHostContext) {
  act(() =>
    root.render(
      <WorkspaceHostProvider workspaceId='workspace-1' initialContext={initialContext}>
        <GetterReader />
        <ContextReader />
      </WorkspaceHostProvider>
    )
  )
}

function textOf(testId: string): string | undefined {
  return host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? undefined
}

beforeEach(() => {
  resetDeploymentShape()
  mockUseWorkspaceHostContextQuery.mockReturnValue({ data: undefined, error: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

describe('WorkspaceHostProvider', () => {
  it('seeds the server deployment shape before workspace children render', () => {
    renderProvider(HOST_CONTEXT)

    expect(textOf('getter')).toBe('true')
    expect(textOf('context')).toBe('true')
    expect(getDeploymentShape()).toBe(HOST_CONTEXT.deployment)
  })

  it('follows a host context that arrives after mount over the initial seed', () => {
    renderProvider(HOST_CONTEXT)
    expect(textOf('context')).toBe('true')
    expect(getDeploymentShape().billingEnabled).toBe(true)

    mockUseWorkspaceHostContextQuery.mockReturnValue({
      data: {
        ...HOST_CONTEXT,
        deployment: { ...HOST_CONTEXT.deployment!, billingEnabled: false },
      },
      error: null,
    })
    renderProvider(HOST_CONTEXT)

    expect(textOf('context')).toBe('false')
    expect(getDeploymentShape().billingEnabled).toBe(false)
  })

  it('keeps the env fallback for a host context that predates deployment projection', () => {
    const { deployment: _legacy, ...legacyContext } = HOST_CONTEXT

    renderProvider(legacyContext)

    expect(textOf('getter')).toBe('false')
    expect(textOf('context')).toBe('undefined')
  })
})
