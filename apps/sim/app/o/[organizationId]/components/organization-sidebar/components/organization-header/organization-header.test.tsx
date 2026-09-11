/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { ToastProvider } from '@sim/emcn'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ upload: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/uploads/client/session-upload', () => ({
  uploadInternalFileSession: mocks.upload,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  usePathname: () => '/o/org-1/home',
}))

import { OrganizationHeader } from '@/app/o/[organizationId]/components/organization-sidebar/components/organization-header/organization-header'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'

const organization = { id: 'org-1', name: 'Design', slug: 'design', logo: null, memberCount: 2 }
let root: Root
let container: HTMLDivElement
let queryClient: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  mocks.upload.mockResolvedValue({ path: '/api/files/serve/organization-logos/logo.png' })
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  queryClient.clear()
  vi.unstubAllGlobals()
})

async function render(canEditLogo = true, isCollapsed = false, onExpandSidebar = vi.fn()) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <OrganizationHeader
            organization={organization}
            canEditLogo={canEditLogo}
            isCollapsed={isCollapsed}
            onExpandSidebar={onExpandSidebar}
          />
        </ToastProvider>
      </QueryClientProvider>
    )
  })
}

async function openMenu() {
  await act(async () => {
    container
      .querySelector('[aria-label="Organization menu"]')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  })
}

function logoControl() {
  return document.querySelector<HTMLElement>(
    '[role="menuitem"][aria-label="Change organization logo"]'
  )
}

async function pickFile(file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

describe('OrganizationHeader logo upload', () => {
  it('opens the native file picker by clicking the logo and keeps the menu open', async () => {
    await render()
    await openMenu()
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    expect(input.accept).toContain('image/png')
    await act(async () => logoControl()!.click())
    expect(click).toHaveBeenCalledOnce()
    expect(logoControl()).not.toBeNull()
    expect(document.body.textContent).not.toContain('Upload logo')
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Settings')
  })

  it.each(['Enter', ' '])('opens the file picker using the %j key', async (key) => {
    await render()
    await openMenu()
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    await act(async () => {
      logoControl()!.focus()
      logoControl()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
    expect(click).toHaveBeenCalledOnce()
  })

  it('does not offer logo changes to members', async () => {
    await render(false)
    await openMenu()
    expect(logoControl()).toBeNull()
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Design')
  })

  it('preserves the collapsed logo as the sidebar expand control', async () => {
    const expand = vi.fn()
    await render(true, true, expand)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Expand sidebar"]')!.click()
    })
    expect(expand).toHaveBeenCalledOnce()
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('disables logo changes while the upload is pending', async () => {
    let completeUpload!: () => void
    mocks.upload.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          completeUpload = resolve
        })
    )
    await render()
    await openMenu()
    await pickFile(new File(['image'], 'logo.png', { type: 'image/png' }))
    await act(async () => {
      await vi.waitFor(() => expect(logoControl()?.getAttribute('aria-disabled')).toBe('true'))
    })
    expect(logoControl()?.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true)
    await act(async () => logoControl()!.click())
    expect(mocks.upload).toHaveBeenCalledOnce()
    await act(async () => completeUpload())
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('uploads under the organization scope and refreshes its identity after success', async () => {
    await render()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const file = new File(['image'], 'logo.png', { type: 'image/png' })
    await pickFile(file)
    expect(mocks.upload).toHaveBeenCalledWith({
      purpose: 'organization_logo',
      organizationId: organization.id,
      file,
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: organizationKeys.detail('org-1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: organizationKeys.lists() })
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('rejects unsupported files before uploading', async () => {
    await render()
    await pickFile(new File(['text'], 'notes.txt', { type: 'text/plain' }))
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('not a supported image format')
  })

  it('keeps the saved identity when upload fails and allows retrying the same file', async () => {
    const file = new File(['image'], 'logo.png', { type: 'image/png' })
    mocks.upload.mockRejectedValueOnce(new Error('Upload failed'))
    await render()
    await pickFile(file)
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Upload failed')
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.value).toBe('')
    await pickFile(file)
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
})
