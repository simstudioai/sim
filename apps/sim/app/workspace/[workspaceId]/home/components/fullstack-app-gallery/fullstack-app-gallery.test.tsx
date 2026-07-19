/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPermissions, mockProjectsQuery, mockPush } = vi.hoisted(() => ({
  mockPermissions: {
    current: {
      canEdit: true,
      isLoading: false,
    },
  },
  mockProjectsQuery: vi.fn(),
  mockPush: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => mockPermissions.current,
}))

vi.mock('@/hooks/queries/apps', () => ({
  useAppProjects: mockProjectsQuery,
}))

import {
  type AppGalleryProject,
  FullstackAppGallery,
  filterAppProjects,
  getAppProjectHref,
  normalizeAppSearch,
} from './fullstack-app-gallery'

function project(
  overrides: Partial<AppGalleryProject> & Pick<AppGalleryProject, 'id' | 'name' | 'slug'>
): AppGalleryProject {
  return {
    workspaceId: 'workspace-1',
    publicId: `public-${overrides.id}`,
    draftRevisionId: null,
    publishedReleaseId: null,
    createdFromChatId: null,
    lastBuilderChatId: null,
    createdBy: 'user-1',
    version: 1,
    archivedAt: null,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    interfaceStatus: 'empty',
    thumbnailUrl: null,
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

describe('FullstackAppGallery', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockPermissions.current = { canEdit: true, isLoading: false }
    mockProjectsQuery.mockReturnValue({
      data: { projects: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('normalizes local name and slug searches', () => {
    const projects = [
      project({ id: 'one', name: 'Résumé Builder', slug: 'resume-builder' }),
      project({ id: 'two', name: 'Inventory', slug: 'stock-room' }),
    ]

    expect(normalizeAppSearch('  RÉSUMÉ  ')).toBe('resume')
    expect(filterAppProjects(projects, 'resume')).toEqual([projects[0]])
    expect(filterAppProjects(projects, 'STOCK-RO')).toEqual([projects[1]])
  })

  it('routes cards to the newest builder chat and falls back to Advanced', () => {
    const linked = project({
      id: 'linked',
      name: 'Linked',
      slug: 'linked',
      createdFromChatId: 'created-chat',
      lastBuilderChatId: 'latest-chat',
    })
    const advanced = project({ id: 'advanced', name: 'Advanced', slug: 'advanced' })

    expect(getAppProjectHref('workspace-1', linked)).toBe('/workspace/workspace-1/chat/latest-chat')
    expect(getAppProjectHref('workspace-1', advanced)).toBe('/workspace/workspace-1/apps/advanced')
  })

  it('filters cards, opens their builder chat, and recovers from a broken thumbnail', async () => {
    const projects = [
      project({
        id: 'one',
        name: 'Résumé Builder',
        slug: 'resume-builder',
        lastBuilderChatId: 'chat-1',
        interfaceStatus: 'ready',
        thumbnailUrl: '/thumbnails/one.png',
      }),
      project({ id: 'two', name: 'Inventory', slug: 'stock-room' }),
    ]
    mockProjectsQuery.mockReturnValue({
      data: { projects },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    await act(async () => {
      root.render(<FullstackAppGallery workspaceId='workspace-1' />)
    })

    const image = container.querySelector('img')
    expect(image?.getAttribute('loading')).toBe('lazy')
    act(() => image?.dispatchEvent(new Event('error')))
    expect(container.querySelector('img')).toBeNull()

    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        search,
        'resume'
      )
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.textContent).toContain('Résumé Builder')
    expect(container.textContent).not.toContain('Inventory')

    act(() => container.querySelector<HTMLButtonElement>('li button')?.click())
    expect(mockPush).toHaveBeenCalledWith('/workspace/workspace-1/chat/chat-1')
  })

  it('preserves permission and empty states', async () => {
    mockPermissions.current = { canEdit: false, isLoading: false }

    await act(async () => {
      root.render(<FullstackAppGallery workspaceId='workspace-1' />)
    })

    expect(container.textContent).toContain('Workspace write permission is required')
    expect(mockProjectsQuery).toHaveBeenCalledWith('workspace-1', { enabled: false })

    mockPermissions.current = { canEdit: true, isLoading: false }
    await act(async () => {
      root.render(<FullstackAppGallery workspaceId='workspace-1' />)
    })
    expect(container.textContent).toContain('No apps yet')
  })
})
