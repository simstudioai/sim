/**
 * GET /api/v1/admin/onprem-telemetry/deployments/[id]/rates
 *
 * Full rate history for a deployment, newest first.
 *
 * Response: AdminSingleResponse<{ rates: AdminV1OnPremRate[] }>
 *
 * POST /api/v1/admin/onprem-telemetry/deployments/[id]/rates
 *
 * Append a rate. Rates are never edited or deleted; a new row supersedes the
 * previous one from `effectiveFrom` on, and dollars are derived at read time,
 * so historical periods re-value only when a rate is backdated over them.
 *
 * Body:
 *   - usdPerCredit: number
 *   - effectiveFrom?: ISO date (defaults to now)
 *
 * Response: AdminSingleResponse<AdminV1OnPremRate>
 */

import { db } from '@sim/db'
import { onpremDeploymentRate } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import {
  adminV1CreateOnPremRateContract,
  adminV1ListOnPremRatesContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  findDeployment,
  loadRates,
  presentRate,
  toEffectiveRate,
} from '@/lib/onprem-telemetry/presenters'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

interface RouteParams {
  id: string
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1ListOnPremRatesContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    if (!(await findDeployment(id))) return notFoundResponse('Deployment')

    const rates = (await loadRates([id])).get(id) ?? []
    return singleResponse({ rates: rates.map(presentRate).reverse() })
  })
)

export const POST = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1CreateOnPremRateContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    if (!(await findDeployment(id))) return notFoundResponse('Deployment')

    const { usdPerCredit, effectiveFrom } = parsed.data.body
    const now = new Date()
    const [row] = await db
      .insert(onpremDeploymentRate)
      .values({
        id: generateId(),
        deploymentId: id,
        usdPerCredit: usdPerCredit.toString(),
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : now,
        createdAt: now,
      })
      .returning()

    return singleResponse(presentRate(toEffectiveRate(row)))
  })
)
