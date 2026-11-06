/**
 * @vitest-environment jsdom
 *
 * Failure mode: the catalog goes stale while an admin edits. A group with an unrestricted allowlist
 * materializes it from the catalog on its first narrowing, so a block missing from the catalog is
 * silently left out of what gets stored. The catalog has to be able to read again, and creating a
 * custom block has to invalidate it.
 */
import { act } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePublishCustomBlock } from '@/hooks/queries/custom-blocks'
import { permissionGroupKeys } from '@/hooks/queries/utils/permission-group-keys'
import { usePermissionEditorModel } from '@/platform/embedded/lib/data/access-control/editor'
import { renderDataHook, unmountDataHooks } from '@/platform/embedded/lib/render-hook.test-support'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('next/navigation', () => nextNavigationMock)

const CATALOG = { blocks: [], providers: [], knowledgeConnectors: [] }

describe('the permission editor catalog', () => {
  beforeEach(() => {
    apiClientRequestMockFns.mockRequestJson.mockReset()
    apiClientRequestMockFns.mockRequestJson.mockResolvedValue(CATALOG)
  })
  afterEach(unmountDataHooks)

  it('reads over its route when no server seed reached it', async () => {
    const rendered = await renderDataHook(() => usePermissionEditorModel('org-1'))
    await vi.waitFor(() => expect(rendered.result.current.model).not.toBeNull())
    expect(
      apiClientRequestMockFns.mockRequestJson.mock.calls.some(([contract]) =>
        (contract as { path: string }).path.includes('editor-catalog')
      )
    ).toBe(true)
  })

  it('is invalidated when a custom block is published', async () => {
    const rendered = await renderDataHook(() => usePublishCustomBlock())
    rendered.queryClient.setQueryData(permissionGroupKeys.editorCatalog('org-1'), CATALOG)
    await act(async () => {
      await rendered.result.current.mutateAsync({} as never)
    })
    expect(
      rendered.queryClient.getQueryState(permissionGroupKeys.editorCatalog('org-1'))?.isInvalidated
    ).toBe(true)
  })
})
