/**
 * GET /api/v1/admin/onprem-telemetry/deployments
 *
 * List registered on-prem deployments with their current rate and last report time.
 *
 * Response: AdminListResponse<AdminV1OnPremDeployment>
 *
 * POST /api/v1/admin/onprem-telemetry/deployments
 *
 * Register a deployment and issue its API key. The key is returned once and
 * never stored in the clear; the operator sets it as ONPREM_TELEMETRY_API_KEY.
 *
 * Body:
 *   - name: string
 *   - id?: string - slug the deployment will report as (generated when omitted)
 *   - usdPerCredit?: number - initial rate, effective immediately
 *
 * Response: AdminSingleResponse<AdminV1OnPremDeployment & { apiKey: string }>
 */

import { randomBytes } from 'node:crypto'
import { db } from '@sim/db'
import { onpremDeployment, onpremDeploymentRate } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { count, desc } from 'drizzle-orm'
import {
  adminV1CreateOnPremDeploymentContract,
  adminV1ListOnPremDeploymentsContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { findDeployment, presentDeployments } from '@/lib/onprem-telemetry/presenters'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  conflictResponse,
  listResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

/** Prefixed so a leaked key is recognisable in logs and secret scanners. */
function issueDeploymentApiKey(): string {
  return `simot_${randomBytes(24).toString('hex')}`
}

export const GET = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(
      adminV1ListOnPremDeploymentsContract,
      request,
      {},
      {
        validationErrorResponse: adminValidationErrorResponse,
      }
    )
    if (!parsed.success) return parsed.response

    const { limit, offset } = parsed.data.query
    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(onpremDeployment)
        .orderBy(desc(onpremDeployment.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(onpremDeployment),
    ])

    const data = await presentDeployments(rows)
    return listResponse(data, { total, limit, offset, hasMore: offset + rows.length < total })
  })
)

export const POST = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(
      adminV1CreateOnPremDeploymentContract,
      request,
      {},
      {
        validationErrorResponse: adminValidationErrorResponse,
        invalidJsonResponse: adminInvalidJsonResponse,
      }
    )
    if (!parsed.success) return parsed.response

    const { id: requestedId, name, usdPerCredit } = parsed.data.body
    const id = requestedId ?? generateId()
    if (await findDeployment(id)) {
      return conflictResponse(`Deployment '${id}' already exists`)
    }

    const apiKey = issueDeploymentApiKey()
    const now = new Date()
    const [row] = await db
      .insert(onpremDeployment)
      .values({ id, name, apiKeyHash: sha256Hex(apiKey), createdAt: now, updatedAt: now })
      .returning()
    if (usdPerCredit !== undefined) {
      await db.insert(onpremDeploymentRate).values({
        id: generateId(),
        deploymentId: id,
        usdPerCredit: usdPerCredit.toString(),
        effectiveFrom: now,
        createdAt: now,
      })
    }

    const [presented] = await presentDeployments([row], now)
    return singleResponse({ ...presented, apiKey })
  })
)
