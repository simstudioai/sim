import { apiServerRoutesMock } from '@sim/testing/mocks/api-server-routes.mock'
import { mothershipHeadlessLifecycleMock } from '@sim/testing/mocks/mothership-headless-lifecycle.mock'
import { triggersMock } from '@sim/testing/mocks/triggers.mock'
import { expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => triggersMock)
vi.mock('@/lib/mothership/request/lifecycle/headless', () => mothershipHeadlessLifecycleMock)

const inventory = vi.hoisted(
  () =>
    [] as Array<{
      method: string
      path: string
      operation: ApplicationOperation
      useCase: CopilotRouteUseCase
    }>
)
const builder = vi.hoisted(
  () =>
    (options: {
      contract: { method: string; path: string }
      operation: ApplicationOperation
      useCase: CopilotRouteUseCase
    }) => {
      inventory.push({
        method: options.contract.method,
        path: options.contract.path,
        operation: options.operation,
        useCase: options.useCase,
      })
      return async () => new Response()
    }
)
vi.mock('@/lib/api/server/routes/v2-json-route', () => ({
  ...apiServerRoutesMock,
  defineV2JsonRoute: builder,
}))
vi.mock('@/lib/api/server/routes/v2-binary-route', () => ({
  ...apiServerRoutesMock,
  defineV2BinaryRoute: builder,
}))
vi.mock('@/lib/api/server/routes/v2-body-lifecycle-route', () => ({
  ...apiServerRoutesMock,
  defineV2BodyLifecycleRoute: builder,
}))

import {
  type CopilotRouteUseCase,
  copilotRouteAudience,
} from '@/lib/api/server/routes/copilot-request'
import { V2_ROUTES } from '@/lib/api/server/routes/v2-route-table.generated'
import type { ApplicationOperation } from '@/lib/core/application/operation'

/**
 * Routes Mothership refuses, judged by the rule admission itself runs. The CLI command
 * inventory (`packages/sim-cli/scripts/print-command-inventory.ts`) reads this file to mark
 * the commands chat cannot run, so the agent is never shown one. After changing a use
 * case's delegation, refresh it with `vitest run -u` on this file and review the diff.
 */
const REFUSED_ROUTES_FILE = './copilot-refused-routes.json'

it('inventories private operation admission without executing route requests', async () => {
  for (const route of V2_ROUTES) await route.load()
  expect(inventory.length).toBeGreaterThan(200)
  const audiences = inventory.map((route) => copilotRouteAudience(route.operation, route.useCase))
  /** Public organization and version-history operations require a direct caller. */
  const refused = inventory
    .filter((_, index) => !audiences[index])
    .map(({ method, path, operation }) => ({ method, path, operation: operation.id }))
  await expect(`${JSON.stringify(refused, null, 2)}\n`).toMatchFileSnapshot(REFUSED_ROUTES_FILE)
  expect(audiences.filter(Boolean).every((audience) => audience?.startsWith('sim:'))).toBe(true)
}, 60000)
