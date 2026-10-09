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
const built = vi.hoisted(() => new WeakSet<object>())
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
      const handler = async () => new Response()
      built.add(handler)
      return handler
    }
)
/** The raw route being invoked, so its admission call can be attributed to it. */
const invoking = vi.hoisted(() => ({ method: '', path: '' }))
const recordAdmission = vi.hoisted(
  () =>
    async (
      _request: Request,
      operation: ApplicationOperation,
      _auth: unknown,
      _rateLimit: unknown,
      useCase?: CopilotRouteUseCase
    ) => {
      inventory.push({ ...invoking, operation, useCase })
      return { success: false, response: new Response(null, { status: 403 }) }
    }
)
vi.mock('@/lib/api/server/routes/v2-json-route', () => ({
  ...apiServerRoutesMock,
  defineV2JsonRoute: builder,
  admitV2Request: recordAdmission,
  admitOptionalV2Request: recordAdmission,
}))
vi.mock('@/lib/api/server/routes/v2-binary-route', () => ({
  ...apiServerRoutesMock,
  defineV2BinaryRoute: builder,
}))
vi.mock('@/lib/api/server/routes/v2-body-lifecycle-route', () => ({
  ...apiServerRoutesMock,
  defineV2BodyLifecycleRoute: builder,
}))

import { NextRequest } from 'next/server'
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

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/**
 * A raw route (chat, workflow execute and resume) admits inside its handler, so it is
 * invoked once and its admission call recorded, which ends the request before any work.
 */
async function inventoryRawHandlers(pattern: string, module: object): Promise<void> {
  for (const method of METHODS) {
    const handler: unknown = Reflect.get(module, method)
    if (typeof handler !== 'function' || built.has(handler)) continue
    invoking.method = method
    invoking.path = pattern.replace(/\{([^}]+)\}/g, '[$1]')
    await handler(new NextRequest(`http://localhost${invoking.path}`, { method }), {
      params: Promise.resolve({}),
    })
  }
}

it('inventories private operation admission without executing use cases', async () => {
  for (const route of V2_ROUTES) await inventoryRawHandlers(route.pattern, await route.load())
  expect(inventory.length).toBeGreaterThan(200)
  expect(inventory.find((route) => route.path === '/api/v2/chat')?.operation.id).toBe('chat.send')
  const audiences = inventory.map((route) => copilotRouteAudience(route.operation, route.useCase))
  /**
   * Operations that require a direct caller. Chat reaches organization administration through
   * `settings organization`; version delete and download stay direct-only on purpose.
   */
  const refused = inventory
    .filter((_, index) => !audiences[index])
    .map(({ method, path, operation }) => ({ method, path, operation: operation.id }))
  await expect(`${JSON.stringify(refused, null, 2)}\n`).toMatchFileSnapshot(REFUSED_ROUTES_FILE)
  expect(audiences.filter(Boolean).every((audience) => audience?.startsWith('sim:'))).toBe(true)
}, 60000)
