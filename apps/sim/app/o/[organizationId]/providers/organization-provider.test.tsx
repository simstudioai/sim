/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseMothershipChatEvents } = vi.hoisted(() => ({
  mockUseMothershipChatEvents: vi.fn(),
}))

vi.mock('@/hooks/use-mothership-chat-events', () => ({
  useMothershipChatEvents: mockUseMothershipChatEvents,
}))

import type { DeploymentShape } from '@/lib/api/contracts/workspaces'
import {
  getDeploymentShape,
  resetDeploymentShape,
  resolveDeploymentShape,
  useDeploymentShape,
} from '@/lib/core/config/deployment-shape'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { OrganizationProvider } from '@/app/o/[organizationId]/providers/organization-provider'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SURFACE_CONTEXT = {
  organization: { id: 'org-1', name: 'Acme', slug: 'acme', logo: null, memberCount: 1 },
  viewer: { role: 'member', isAdmin: false },
  searchAccess: { memberScoped: true, sourceMirrored: true },
} as unknown as OrganizationSurfaceContext

/** The server's shape differs from this test environment's env fallback in every field read below. */
function serverShape(): DeploymentShape {
  const fallback = resolveDeploymentShape()
  return {
    ...fallback,
    hosted: !fallback.hosted,
    chatEnabled: !fallback.chatEnabled,
    features: { ...fallback.features, scim: !fallback.features.scim },
  }
}

/** Reads the hook during render, the way the SSO settings page gates its Provisioning tab. */
function ScimReader() {
  return <output data-testid='scim'>{String(useDeploymentShape().features.scim)}</output>
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  resetDeploymentShape()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

describe('OrganizationProvider', () => {
  it('seeds the server deployment shape before organization children render', () => {
    const deployment = serverShape()

    act(() =>
      root.render(
        <OrganizationProvider context={SURFACE_CONTEXT} deployment={deployment}>
          <ScimReader />
        </OrganizationProvider>
      )
    )

    expect(host.querySelector('[data-testid="scim"]')?.textContent).toBe(
      String(deployment.features.scim)
    )
    expect(getDeploymentShape()).toBe(deployment)
  })

  it('subscribes to organization chat events from the server-resolved chat switch', () => {
    const deployment = serverShape()

    act(() =>
      root.render(
        <OrganizationProvider context={SURFACE_CONTEXT} deployment={deployment}>
          {null}
        </OrganizationProvider>
      )
    )

    expect(mockUseMothershipChatEvents).toHaveBeenCalledWith(
      { organizationId: 'org-1' },
      deployment.chatEnabled
    )
  })
})
