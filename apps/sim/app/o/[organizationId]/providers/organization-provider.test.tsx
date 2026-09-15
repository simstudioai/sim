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

import {
  getDeploymentShape,
  resetDeploymentShape,
  resolveDeploymentShape,
  useDeploymentShape,
} from '@/lib/core/config/deployment-shape'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { OrganizationProvider } from '@/app/o/[organizationId]/providers/organization-provider'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
  it("seeds the context's deployment shape before children render and follows its chat switch", () => {
    /** Differs from this environment's env fallback in every field read below. */
    const fallback = resolveDeploymentShape()
    const deployment = {
      ...fallback,
      chatEnabled: !fallback.chatEnabled,
      features: { ...fallback.features, scim: !fallback.features.scim },
    }
    const context = {
      organization: { id: 'org-1', name: 'Acme', slug: 'acme', logo: null, memberCount: 1 },
      searchAccess: { memberScoped: true, sourceMirrored: true },
      deployment,
    } as unknown as OrganizationSurfaceContext

    act(() =>
      root.render(
        <OrganizationProvider context={context}>
          <ScimReader />
        </OrganizationProvider>
      )
    )

    expect(host.querySelector('[data-testid="scim"]')?.textContent).toBe(
      String(deployment.features.scim)
    )
    expect(getDeploymentShape()).toBe(deployment)
    expect(mockUseMothershipChatEvents).toHaveBeenCalledWith(
      { organizationId: 'org-1' },
      deployment.chatEnabled
    )
  })
})
