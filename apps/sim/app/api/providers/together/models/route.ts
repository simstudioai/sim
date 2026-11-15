import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { togetherProviderModelsQuerySchema } from '@/lib/api/contracts/providers'
import { validationErrorResponse } from '@/lib/api/server'
import { authenticateOptionalInternalSession } from '@/lib/api/server/routes'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listProviderModels } from '@/lib/provider-models/application/list-models'
import { isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('TogetherModelsAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  if (isProviderBlacklisted('together')) {
    logger.info('Together provider is blacklisted, returning empty models')
    return NextResponse.json({ models: [] })
  }

  const queryValidation = togetherProviderModelsQuerySchema.safeParse({
    workspaceId: request.nextUrl.searchParams.get('workspaceId') ?? undefined,
  })
  if (!queryValidation.success) return validationErrorResponse(queryValidation.error)
  const { workspaceId } = queryValidation.data

  const principal = workspaceId ? await authenticateOptionalInternalSession() : null
  const models = await listProviderModels('together', { principal, workspaceId })
  return NextResponse.json({ models })
})
