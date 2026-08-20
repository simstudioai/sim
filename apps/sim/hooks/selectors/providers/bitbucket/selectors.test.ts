/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({ mockRequestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))

import { getSelectorDefinition } from '@/hooks/selectors/registry'
import type { SelectorQueryArgs } from '@/hooks/selectors/types'

const workspaces = getSelectorDefinition('bitbucket.workspaces')
const repositories = getSelectorDefinition('bitbucket.repositories')

const workspaceArgs = (
  overrides: Partial<SelectorQueryArgs['context']> = {}
): SelectorQueryArgs => ({
  key: 'bitbucket.workspaces',
  context: { oauthCredential: 'credential-1', workflowId: 'workflow-1', ...overrides },
})

const repositoryArgs = (
  overrides: Partial<SelectorQueryArgs['context']> = {}
): SelectorQueryArgs => ({
  key: 'bitbucket.repositories',
  context: {
    oauthCredential: 'credential-1',
    workflowId: 'workflow-1',
    workspaceSlug: 'acme-platform',
    ...overrides,
  },
})

describe('bitbucket.workspaces selector', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is enabled only after a credential is selected and isolates each authorization context', () => {
    expect(workspaces.enabled?.(workspaceArgs())).toBe(true)
    expect(workspaces.enabled?.(workspaceArgs({ oauthCredential: undefined }))).toBe(false)
    expect(workspaces.getQueryKey(workspaceArgs())).toEqual([
      'selectors',
      'bitbucket.workspaces',
      'credential-1',
      'workflow-1',
    ])
    expect(workspaces.getQueryKey(workspaceArgs({ oauthCredential: 'credential-2' }))).toEqual([
      'selectors',
      'bitbucket.workspaces',
      'credential-2',
      'workflow-1',
    ])
    expect(workspaces.getQueryKey(workspaceArgs({ workflowId: 'workflow-2' }))).toEqual([
      'selectors',
      'bitbucket.workspaces',
      'credential-1',
      'workflow-2',
    ])
  })

  it('loads one page using a credential id and preserves provider metadata', async () => {
    const nextCursor = 'https://api.bitbucket.org/2.0/user/workspaces?page=2&pagelen=100'
    mockRequestJson.mockResolvedValue({
      workspaces: [
        {
          slug: 'acme-platform',
          uuid: '{workspace-uuid}',
          name: 'Acme Platform',
          administrator: true,
        },
      ],
      nextCursor,
    })

    const page = await workspaces.fetchPage?.({
      ...workspaceArgs(),
      cursor: 'https://api.bitbucket.org/2.0/user/workspaces?page=1&pagelen=100',
    })

    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/tools/bitbucket/workspaces' }),
      expect.objectContaining({
        body: {
          credential: 'credential-1',
          workflowId: 'workflow-1',
          cursor: 'https://api.bitbucket.org/2.0/user/workspaces?page=1&pagelen=100',
        },
      })
    )
    expect(page).toEqual({
      items: [
        {
          id: 'acme-platform',
          label: 'Acme Platform',
          meta: {
            slug: 'acme-platform',
            uuid: '{workspace-uuid}',
            fullName: 'Acme Platform',
            administrator: true,
          },
        },
      ],
      nextCursor,
    })
  })

  it('rejects a missing credential before making a route request', async () => {
    await expect(
      workspaces.fetchPage?.(workspaceArgs({ oauthCredential: undefined }))
    ).rejects.toThrow(/Missing credential/)
    expect(mockRequestJson).not.toHaveBeenCalled()
  })
})

describe('bitbucket.repositories selector', () => {
  beforeEach(() => vi.clearAllMocks())

  it('waits for both dependencies and isolates pages by auth context and workspace', () => {
    expect(repositories.enabled?.(repositoryArgs())).toBe(true)
    expect(repositories.enabled?.(repositoryArgs({ oauthCredential: undefined }))).toBe(false)
    expect(repositories.enabled?.(repositoryArgs({ workspaceSlug: undefined }))).toBe(false)

    expect(repositories.getQueryKey(repositoryArgs())).toEqual([
      'selectors',
      'bitbucket.repositories',
      'credential-1',
      'workflow-1',
      'acme-platform',
    ])
    expect(repositories.getQueryKey(repositoryArgs({ workspaceSlug: 'other-team' }))).toEqual([
      'selectors',
      'bitbucket.repositories',
      'credential-1',
      'workflow-1',
      'other-team',
    ])
    expect(repositories.getQueryKey(repositoryArgs({ oauthCredential: 'credential-2' }))).toEqual([
      'selectors',
      'bitbucket.repositories',
      'credential-2',
      'workflow-1',
      'acme-platform',
    ])
    expect(repositories.getQueryKey(repositoryArgs({ workflowId: 'workflow-2' }))).toEqual([
      'selectors',
      'bitbucket.repositories',
      'credential-1',
      'workflow-2',
      'acme-platform',
    ])
  })

  it('keeps the workspace dependency on every page and maps slug ids with UUID/full-name metadata', async () => {
    const nextCursor = 'https://api.bitbucket.org/2.0/repositories/acme-platform?page=3&pagelen=100'
    mockRequestJson.mockResolvedValue({
      repositories: [
        {
          slug: 'payments-api',
          uuid: '{repository-uuid}',
          name: 'Payments API',
          fullName: 'acme-platform/payments-api',
        },
      ],
      nextCursor,
    })

    const page = await repositories.fetchPage?.({
      ...repositoryArgs(),
      cursor: 'https://api.bitbucket.org/2.0/repositories/acme-platform?page=2&pagelen=100',
    })

    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/tools/bitbucket/repositories' }),
      expect.objectContaining({
        body: {
          credential: 'credential-1',
          workflowId: 'workflow-1',
          workspaceSlug: 'acme-platform',
          cursor: 'https://api.bitbucket.org/2.0/repositories/acme-platform?page=2&pagelen=100',
        },
      })
    )
    expect(page).toEqual({
      items: [
        {
          id: 'payments-api',
          label: 'Payments API',
          meta: {
            slug: 'payments-api',
            uuid: '{repository-uuid}',
            fullName: 'acme-platform/payments-api',
            workspaceSlug: 'acme-platform',
          },
        },
      ],
      nextCursor,
    })
  })

  it('rejects a missing workspace dependency instead of issuing an unscoped request', async () => {
    await expect(
      repositories.fetchPage?.(repositoryArgs({ workspaceSlug: undefined }))
    ).rejects.toThrow(/Missing workspace slug/)
    expect(mockRequestJson).not.toHaveBeenCalled()
  })

  it('rejects a missing credential before making a route request', async () => {
    await expect(
      repositories.fetchPage?.(repositoryArgs({ oauthCredential: undefined }))
    ).rejects.toThrow(/Missing credential/)
    expect(mockRequestJson).not.toHaveBeenCalled()
  })
})
