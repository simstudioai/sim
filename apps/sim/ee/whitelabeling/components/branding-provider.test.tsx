/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseWhitelabelSettings } = vi.hoisted(() => ({
  mockUseWhitelabelSettings: vi.fn(),
}))

vi.mock('@/ee/whitelabeling/hooks/whitelabel', () => ({
  useWhitelabelSettings: mockUseWhitelabelSettings,
}))

import {
  BrandingProvider,
  useOrgBrandConfig,
} from '@/ee/whitelabeling/components/branding-provider'

function BrandIdentity() {
  const config = useOrgBrandConfig()
  return (
    <>
      <span>{config.name}</span>
      <img src={config.logoUrl} alt='Brand logo' />
    </>
  )
}

let container: HTMLDivElement
let root: Root

function mount(ui: ReactNode) {
  act(() => {
    root.render(ui)
  })
}

describe('BrandingProvider', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockUseWhitelabelSettings.mockImplementation((organizationId: string | undefined) => ({
      data:
        organizationId === 'org-b'
          ? { brandName: 'Host B', logoUrl: 'https://host-b.example/logo.png' }
          : organizationId === 'org-a'
            ? { brandName: 'Viewer A', logoUrl: 'https://viewer-a.example/logo.png' }
            : undefined,
    }))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('uses routed host organization branding when the viewer active organization differs', () => {
    mount(
      <BrandingProvider
        hostOrganizationId='org-b'
        viewerIsHostOrganizationMember
        initialOrgSettings={{
          brandName: 'Host B',
          logoUrl: 'https://host-b.example/logo.png',
        }}
      >
        <BrandIdentity />
      </BrandingProvider>
    )

    expect(mockUseWhitelabelSettings).toHaveBeenCalledWith('org-b')
    expect(container).toHaveTextContent('Host B')
    expect(container).not.toHaveTextContent('Viewer A')
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://host-b.example/logo.png')
  })

  it('uses hydrated host branding without an organization-member fetch for collaborators', () => {
    mount(
      <BrandingProvider
        hostOrganizationId='org-b'
        viewerIsHostOrganizationMember={false}
        initialOrgSettings={{
          brandName: 'Host B',
          logoUrl: 'https://host-b.example/logo.png',
        }}
      >
        <BrandIdentity />
      </BrandingProvider>
    )

    expect(mockUseWhitelabelSettings).toHaveBeenCalledWith(undefined)
    expect(mockUseWhitelabelSettings).not.toHaveBeenCalledWith('org-a')
    expect(mockUseWhitelabelSettings).not.toHaveBeenCalledWith('org-b')
    expect(container).toHaveTextContent('Host B')
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://host-b.example/logo.png')
  })
})
