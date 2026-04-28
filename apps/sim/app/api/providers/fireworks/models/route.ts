import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getBYOKKey } from '@/lib/api-key/byok'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('FireworksModelsAPI')

interface FireworksModel {
  id: string
  object?: string
  created?: number
  owned_by?: string
}

interface FireworksModelsResponse {
  data: FireworksModel[]
  object?: string
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  if (isProviderBlacklisted('fireworks')) {
    logger.info('Fireworks provider is blacklisted, returning empty models')
    return NextResponse.json({ models: [] })
  }

  let apiKey: string | undefined

  const workspaceId = request.nextUrl.searchParams.get('workspaceId')
  if (workspaceId) {
    const session = await getSession()
    if (session?.user?.id) {
      const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
      if (permission) {
        const byokResult = await getBYOKKey(workspaceId, 'fireworks')
        if (byokResult) {
          apiKey = byokResult.apiKey
        }
      }
    }
  }

  if (!apiKey) {
    apiKey = env.FIREWORKS_API_KEY
  }

  if (!apiKey) {
    logger.info('No Fireworks API key available, returning empty models')
    return NextResponse.json({ models: [] })
  }

  try {
    const response = await fetch('https://api.fireworks.ai/inference/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      logger.warn('Failed to fetch Fireworks models', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = (await response.json()) as FireworksModelsResponse

    const allModels: string[] = []
    for (const model of data.data ?? []) {
      allModels.push(`fireworks/${model.id}`)
    }

    const uniqueModels = Array.from(new Set(allModels))
    const models = filterBlacklistedModels(uniqueModels)

    logger.info('Successfully fetched Fireworks models', {
      count: models.length,
      filtered: uniqueModels.length - models.length,
    })

    return NextResponse.json({ models })
  } catch (error) {
    logger.error('Error fetching Fireworks models', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ models: [] })
  }
})
