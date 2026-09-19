/** @vitest-environment node */
import { expect, it, vi } from 'vitest'

const inventory = vi.hoisted(
  () => [] as Array<{ method: string; path: string; operation: string; audience: string | null }>
)
const builder = vi.hoisted(
  () =>
    (options: {
      contract: { method: string; path: string }
      operation: { id: string }
      useCase: { delegationAudience?: string }
    }) => {
      inventory.push({
        method: options.contract.method,
        path: options.contract.path,
        operation: options.operation.id,
        audience: options.useCase.delegationAudience ?? null,
      })
      return async () => new Response()
    }
)
vi.mock('@/lib/api/server/routes/v2-json-route', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  defineV2JsonRoute: builder,
}))
vi.mock('@/lib/api/server/routes/v2-binary-route', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  defineV2BinaryRoute: builder,
}))
vi.mock('@/lib/api/server/routes/v2-body-lifecycle-route', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  defineV2BodyLifecycleRoute: builder,
}))

import { matchV2Route } from '@/lib/api/server/routes/in-process-transport'
import { V2_ROUTES } from '@/lib/api/server/routes/v2-route-table.generated'

it('inventories private operation admission without executing route requests', async () => {
  for (const route of V2_ROUTES) await route.load()
  expect(inventory.length).toBeGreaterThan(200)
  // Staging's version-history operations remain direct-caller only.
  expect(inventory.filter((route) => !route.audience)).toEqual([
    {
      method: 'GET',
      path: '/api/v2/files/[fileId]/versions',
      operation: 'files.versions.list',
      audience: null,
    },
    {
      method: 'GET',
      path: '/api/v2/files/[fileId]/versions/[version]',
      operation: 'files.versions.read',
      audience: null,
    },
    {
      method: 'DELETE',
      path: '/api/v2/files/[fileId]/versions/[version]',
      operation: 'files.versions.delete',
      audience: null,
    },
    {
      method: 'GET',
      path: '/api/v2/files/[fileId]/versions/[version]/content',
      operation: 'files.versions.download',
      audience: null,
    },
    {
      method: 'POST',
      path: '/api/v2/files/[fileId]/versions/[version]/revert',
      operation: 'files.versions.revert',
      audience: null,
    },
    {
      method: 'GET',
      path: '/api/v2/files/[fileId]/versions/[version]/text',
      operation: 'files.versions.read_content',
      audience: null,
    },
    { method: 'GET', path: '/api/v2/meta', operation: 'meta.capabilities.read', audience: null },
    {
      method: 'GET',
      path: '/api/v2/workspaces',
      operation: 'workspaces.list_public',
      audience: null,
    },
  ])
  expect(
    inventory.filter((route) => route.audience).every((route) => route.audience?.startsWith('sim:'))
  ).toBe(true)
}, 60000)

it('leaves unknown paths to the network fallback without shadowing real routes', () => {
  expect(matchV2Route('/api/v2/unknown')).toBeNull()
  expect(matchV2Route('/api/v2/unknown/nested')).toBeNull()
  expect(matchV2Route('/api/v2/blocks')).not.toBeNull()
  expect(matchV2Route('/api/v2/files/file-1/versions/2')?.params).toEqual({
    fileId: 'file-1',
    version: '2',
  })
})
