import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'
import { formatAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import {
  buildFilterConditions,
  buildOrgScopeCondition,
  queryAuditLogs,
} from '@/app/api/v1/audit-logs/query'

const logger = createLogger('AuditLogsAPI')

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(async (request: Request) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const authResult = await validateEnterpriseAuditAccess(session.user.id)
    if (!authResult.success) {
      return authResult.response
    }

    const { orgMemberIds } = authResult.context

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')?.trim() || undefined
    const startDate = searchParams.get('startDate') || undefined
    const endDate = searchParams.get('endDate') || undefined
    const includeDeparted = searchParams.get('includeDeparted') === 'true'
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 100)
    const cursor = searchParams.get('cursor') || undefined

    if (startDate && Number.isNaN(Date.parse(startDate))) {
      return NextResponse.json({ error: 'Invalid startDate format' }, { status: 400 })
    }
    if (endDate && Number.isNaN(Date.parse(endDate))) {
      return NextResponse.json({ error: 'Invalid endDate format' }, { status: 400 })
    }

    const scopeCondition = await buildOrgScopeCondition(orgMemberIds, includeDeparted)
    const filterConditions = buildFilterConditions({
      action: searchParams.get('action') || undefined,
      resourceType: searchParams.get('resourceType') || undefined,
      actorId: searchParams.get('actorId') || undefined,
      search,
      startDate,
      endDate,
    })

    const { data, nextCursor } = await queryAuditLogs(
      [scopeCondition, ...filterConditions],
      limit,
      cursor
    )

    return NextResponse.json({
      success: true,
      data: data.map(formatAuditLogEntry),
      nextCursor,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Audit logs fetch error', { error: message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
