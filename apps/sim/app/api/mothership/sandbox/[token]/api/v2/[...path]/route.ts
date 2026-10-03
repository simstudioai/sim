import type { NextRequest } from 'next/server'
import {
  type MothershipSandboxParams,
  mothershipSandboxParamsSchema,
} from '@/lib/api/contracts/mothership-sandbox'
import { validationErrorResponse } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { proxySandboxResourceRequest } from '@/lib/mothership/tools/sandbox-resource-transport'

export const dynamic = 'force-dynamic'

/** Raw transport boundary preserves v2 JSON, multipart and binary bodies; v2 owns operation authorization. */
const handler = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<MothershipSandboxParams> }) => {
    const params = mothershipSandboxParamsSchema.safeParse(await context.params)
    if (!params.success) return validationErrorResponse(params.error)
    return proxySandboxResourceRequest(request, params.data.token)
  }
)

export const GET = handler
export const HEAD = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const OPTIONS = handler
