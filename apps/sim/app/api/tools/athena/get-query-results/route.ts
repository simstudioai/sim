import { GetQueryResultsCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAthenaGetQueryResultsContract } from '@/lib/api/contracts/tools/aws/athena-get-query-results'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaGetQueryResults')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAthenaGetQueryResultsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    const client = createAthenaClient({
      region: data.region,
      accessKeyId: data.accessKeyId,
      secretAccessKey: data.secretAccessKey,
    })

    const isFirstPage = !data.nextToken
    const adjustedMaxResults =
      data.maxResults !== undefined && isFirstPage ? data.maxResults + 1 : data.maxResults

    const command = new GetQueryResultsCommand({
      QueryExecutionId: data.queryExecutionId,
      ...(adjustedMaxResults !== undefined && { MaxResults: adjustedMaxResults }),
      ...(data.nextToken && { NextToken: data.nextToken }),
    })

    const response = await client.send(command)

    const columnInfo = response.ResultSet?.ResultSetMetadata?.ColumnInfo ?? []
    const columns = columnInfo.map((col) => ({
      name: col.Name ?? '',
      type: col.Type ?? 'varchar',
    }))

    const rawRows = response.ResultSet?.Rows ?? []
    const dataRows = data.nextToken ? rawRows : rawRows.slice(1)
    const rows = dataRows.map((row) => {
      const record: Record<string, string> = {}
      const rowData = row.Data ?? []
      for (let i = 0; i < columns.length; i++) {
        record[columns[i].name] = rowData[i]?.VarCharValue ?? ''
      }
      return record
    })

    return NextResponse.json({
      success: true,
      output: {
        columns,
        rows,
        nextToken: response.NextToken ?? null,
        updateCount: response.UpdateCount ?? null,
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to get Athena query results')
    logger.error('GetQueryResults failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
