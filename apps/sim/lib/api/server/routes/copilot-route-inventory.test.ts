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

import { V2_ROUTES } from '@/lib/api/server/routes/v2-route-table.generated'

it('inventories private operation admission without executing route requests', async () => {
  for (const route of V2_ROUTES) await route.load()
  expect(inventory.length).toBeGreaterThan(200)
  expect(inventory.filter((route) => !route.audience)).toEqual([
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
