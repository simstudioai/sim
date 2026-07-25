/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockBuildCustomBlockConfig,
  mockGetCustomBlockIcon,
  mockHydrateClientCustomBlocks,
  mockUseCustomBlocks,
  mockUseOrgBrandConfig,
} = vi.hoisted(() => ({
  mockBuildCustomBlockConfig: vi.fn(),
  mockGetCustomBlockIcon: vi.fn(),
  mockHydrateClientCustomBlocks: vi.fn(),
  mockUseCustomBlocks: vi.fn(),
  mockUseOrgBrandConfig: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-b' }),
}))

vi.mock('@/blocks/custom/build-config', () => ({
  buildCustomBlockConfig: mockBuildCustomBlockConfig,
}))

vi.mock('@/blocks/custom/client-overlay', () => ({
  hydrateClientCustomBlocks: mockHydrateClientCustomBlocks,
}))

vi.mock('@/blocks/custom/custom-block-icon', () => ({
  getCustomBlockIcon: mockGetCustomBlockIcon,
}))

vi.mock('@/ee/whitelabeling/components/branding-provider', () => ({
  useOrgBrandConfig: mockUseOrgBrandConfig,
}))

vi.mock('@/hooks/queries/custom-blocks', () => ({
  useCustomBlocks: mockUseCustomBlocks,
}))

import { CustomBlocksLoader } from '@/app/workspace/[workspaceId]/providers/custom-blocks-loader'

let container: HTMLDivElement
let root: Root

describe('CustomBlocksLoader', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockUseOrgBrandConfig.mockReturnValue({
      logoUrl: 'https://host-b.example/logo.png',
    })
    mockUseCustomBlocks.mockReturnValue({
      data: [
        {
          id: 'custom-block-1',
          type: 'custom_host_block',
          name: 'Host block',
          description: 'A host-branded block',
          workflowId: 'workflow-1',
          exposedOutputs: [],
          inputFields: [],
          iconUrl: null,
          enabled: true,
          organizationId: 'org-b',
        },
      ],
    })
    mockGetCustomBlockIcon.mockReturnValue(() => null)
    mockBuildCustomBlockConfig.mockReturnValue({ type: 'custom_host_block' })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('hydrates no-icon blocks with the access-authorized host logo', () => {
    act(() => {
      root.render(<CustomBlocksLoader />)
    })

    expect(mockUseCustomBlocks).toHaveBeenCalledWith('workspace-b')
    expect(mockGetCustomBlockIcon).toHaveBeenCalledWith(null, 'https://host-b.example/logo.png')
    expect(mockBuildCustomBlockConfig).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'custom_host_block' }),
      [],
      expect.objectContaining({
        bgColor: 'transparent',
        hideFromToolbar: false,
      })
    )
    expect(mockHydrateClientCustomBlocks).toHaveBeenCalledWith([{ type: 'custom_host_block' }])
  })
})
