/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ organizationId: 'org-1' }))

vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.fixture.test' }))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => ({
    organization: { id: mocks.organizationId },
    viewer: { canUsePersonalApiKeys: false },
  }),
}))

import { OrganizationSearchMcp } from '@/app/o/[organizationId]/settings/components/organization-search-mcp'

describe('Organization Search MCP', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.organizationId = 'org-1'
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('offers organization OAuth setup even when personal API keys are disabled', async () => {
    await act(async () => root.render(<OrganizationSearchMcp />))
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe(
      'https://sim.fixture.test/api/mcp/search/organizations/org-1'
    )
    expect(container.querySelector('[aria-label^="MCP app: "]')).not.toBeNull()
    expect(container.textContent).toContain('sign in to Sim')
    expect(container.textContent).not.toContain('API key')
    expect(container.textContent).not.toContain('Authorization header')
  })

  it('replaces the connection scope when the organization changes', async () => {
    await act(async () => root.render(<OrganizationSearchMcp />))
    mocks.organizationId = 'org-2'
    await act(async () => root.render(<OrganizationSearchMcp />))
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe(
      'https://sim.fixture.test/api/mcp/search/organizations/org-2'
    )
    expect(container.innerHTML).not.toContain('/organizations/org-1')
  })
})
