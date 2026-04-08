import { GetQueryResultsCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaGetQueryResults')

const GetQueryResultsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  queryExecutionId: z.string().min(1, 'Query execution ID is required'),
  maxResults: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.number({ coerce: true }).int().positive().max(999).optional()
  ),
  nextToken: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const data = GetQueryResultsSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get Athena query results'
    logger.error('GetQueryResults failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
