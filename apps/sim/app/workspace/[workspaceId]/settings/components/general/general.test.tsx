/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode, Suspense } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANONYMOUS_USER_ID } from '@/lib/auth/constants'

const { mockUseSession, mockUseAuthorizedApps, mockUrlUpdate } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockUseAuthorizedApps: vi.fn(),
  mockUrlUpdate: vi.fn(),
}))

vi.mock('next/dynamic', () => ({
  default: () => AuthorizedApps,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/account/settings/general',
}))
vi.mock('@/lib/auth/auth-client', () => ({ useSession: mockUseSession, signOut: vi.fn() }))
vi.mock('@/lib/core/config/deployment-shape', () => ({
  useDeploymentShape: () => ({ hosted: false }),
}))
vi.mock('@/ee/whitelabeling', () => ({ useBrandConfig: () => ({ logoUrl: '/logo.png' }) }))
vi.mock('@/stores', () => ({ clearUserData: vi.fn() }))
vi.mock('@/hooks/queries/general-settings', () => ({
  useGeneralSettings: () => ({ data: {}, isLoading: false }),
  useUpdateGeneralSetting: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/hooks/queries/user-profile', () => ({
  useUserProfile: () => ({
    data: { name: 'Test user', email: 'user@example.com' },
    isLoading: false,
  }),
  useUpdateUserProfile: () => ({ mutateAsync: vi.fn() }),
  useResetPassword: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/hooks/queries/oauth-provider', () => ({
  useAuthorizedApps: mockUseAuthorizedApps,
  useRevokeAuthorizedApp: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/app/workspace/[workspaceId]/settings/hooks/use-profile-picture-upload', () => ({
  useProfilePictureUpload: () => ({
    fileInputRef: { current: null },
    handleThumbnailClick: vi.fn(),
    handleFileChange: vi.fn(),
  }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/general/components/delete-account-modal',
  () => ({
    DeleteAccountModal: () => null,
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/general/components/privacy-view',
  () => ({
    PrivacyView: () => null,
  })
)
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({
    children,
    title,
    back,
    search,
  }: {
    children: ReactNode
    title?: string
    back?: { onSelect: () => void; text: string }
    search?: { value: string; onChange: (value: string) => void; placeholder: string }
  }) => (
    <>
      {back && (
        <button type='button' onClick={back.onSelect}>
          {back.text}
        </button>
      )}
      {title && <h1>{title}</h1>}
      {search && (
        <input
          aria-label={search.placeholder}
          value={search.value}
          onChange={(event) => search.onChange(event.target.value)}
        />
      )}
      {children}
    </>
  ),
}))

import { AuthorizedApps } from '@/app/workspace/[workspaceId]/settings/components/authorized-apps/authorized-apps'
import { General } from '@/app/workspace/[workspaceId]/settings/components/general/general'

let root: Root
let container: HTMLDivElement

async function renderGeneral(searchParams = '') {
  await act(async () => {
    root.render(
      <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={mockUrlUpdate}>
        <Suspense fallback={null}>
          <General />
        </Suspense>
      </NuqsTestingAdapter>
    )
  })
}

describe('General authorized apps subview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockUseSession.mockReturnValue({ data: { user: { id: 'viewer-a' } } })
    mockUseAuthorizedApps.mockReturnValue({ data: { pages: [{ apps: [] }] }, isPending: false })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('opens the full management view from Account without loading grants beforehand', async () => {
    await renderGeneral('?keep=value')
    expect(mockUseAuthorizedApps).not.toHaveBeenCalled()

    const label = [...container.querySelectorAll('label')].find(
      (node) => node.textContent === 'Authorized apps'
    )!
    await act(async () => label.parentElement!.querySelector('button')!.click())

    expect(container.querySelector('h1')?.textContent).toBe('Authorized apps')
    expect(container.querySelector('input[aria-label="Search authorized apps..."]')).not.toBeNull()
    expect(container.textContent).toContain('No apps have access to your account')
    await vi.waitFor(() => expect(mockUrlUpdate).toHaveBeenCalled())
    const update = mockUrlUpdate.mock.calls.at(-1)![0]
    expect(update.searchParams.get('view')).toBe('authorized-apps')
    expect(update.searchParams.get('keep')).toBe('value')
    expect(update.options.history).toBe('push')
  })

  it('opens a direct link and clears its search on Back without adding history', async () => {
    await renderGeneral('?view=authorized-apps&search=old&keep=value')
    expect(container.querySelector('h1')?.textContent).toBe('Authorized apps')
    expect(mockUseAuthorizedApps).toHaveBeenCalledWith('old')

    const back = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'General'
    )!
    await act(async () => back.click())

    expect(container.querySelector('h1')).toBeNull()
    await vi.waitFor(() => expect(mockUrlUpdate).toHaveBeenCalled())
    const update = mockUrlUpdate.mock.calls.at(-1)![0]
    expect(update.searchParams.has('view')).toBe(false)
    expect(update.searchParams.has('search')).toBe(false)
    expect(update.searchParams.get('keep')).toBe('value')
    expect(update.options.history).toBe('replace')
  })

  it('keeps account grants unavailable when authentication is disabled', async () => {
    mockUseSession.mockReturnValue({ data: { user: { id: ANONYMOUS_USER_ID } } })
    await renderGeneral('?view=authorized-apps')

    expect(container.textContent).not.toContain('Authorized apps')
    expect(mockUseAuthorizedApps).not.toHaveBeenCalled()
  })
})
