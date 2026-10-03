/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseMothershipChatEvents } = vi.hoisted(() => ({
  mockUseMothershipChatEvents: vi.fn(),
}))

vi.mock('@/app/workspace/providers/socket-provider', () => ({
  SocketProvider: ({ children }: { children: import('react').ReactNode }) => children,
}))
vi.mock('@/lib/auth/auth-client', () => authClientMock)
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

authClientMockFns.mockUseSession.mockReturnValue({
  data: { user: { id: 'user-a', email: 'test@example.com' } },
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function ScimReader() {
  return <output data-testid='scim'>{String(useDeploymentShape().features.scim)}</output>
}

let host: HTMLDivElement
let root: Root
let client: QueryClient

beforeEach(() => {
  client = new QueryClient()
  resetDeploymentShape()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  client.clear()
  host.remove()
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
        <QueryClientProvider client={client}>
          <OrganizationProvider context={context}>
            <ScimReader />
          </OrganizationProvider>
        </QueryClientProvider>
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
