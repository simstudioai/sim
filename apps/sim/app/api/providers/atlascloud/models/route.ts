import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  atlascloudProviderModelsQuerySchema,
  atlascloudUpstreamResponseSchema,
  providerModelsResponseSchema,
} from '@/lib/api/contracts/providers'
import { validationErrorResponse } from '@/lib/api/server'
import { getBYOKKey } from '@/lib/api-key/byok'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('AtlasCloudModelsAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  if (isProviderBlacklisted('atlascloud')) {
    logger.info('Atlas Cloud provider is blacklisted, returning empty models')
    return NextResponse.json({ models: [] })
  }

  let apiKey: string | undefined

  const queryValidation = atlascloudProviderModelsQuerySchema.safeParse({
    workspaceId: request.nextUrl.searchParams.get('workspaceId') ?? undefined,
  })
  if (!queryValidation.success) return validationErrorResponse(queryValidation.error)
  const { workspaceId } = queryValidation.data
  if (workspaceId) {
    const session = await getSession()
    if (session?.user?.id) {
      const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
      if (permission) {
        const byokResult = await getBYOKKey(workspaceId, 'atlascloud')
        if (byokResult) {
          apiKey = byokResult.apiKey
        }
      }
    }
  }

  if (!apiKey) {
    apiKey = env.ATLASCLOUD_API_KEY
  }

  if (!apiKey) {
    logger.info('No Atlas Cloud API key available, returning empty models')
    return NextResponse.json({ models: [] })
  }

  try {
    const response = await fetch('https://inference.atlascloud.co/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      logger.warn('Failed to fetch Atlas Cloud models', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = atlascloudUpstreamResponseSchema.parse(await response.json())

    const allModels: string[] = []
    for (const model of data.data ?? []) {
      allModels.push(`atlascloud/${model.id}`)
    }

    const uniqueModels = Array.from(new Set(allModels))
    const models = filterBlacklistedModels(uniqueModels)

    logger.info('Successfully fetched Atlas Cloud models', {
      count: models.length,
      filtered: uniqueModels.length - models.length,
    })

    return NextResponse.json(providerModelsResponseSchema.parse({ models }))
  } catch (error) {
    logger.error('Error fetching Atlas Cloud models', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return NextResponse.json({ models: [] })
  }
})
