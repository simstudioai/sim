import { ListTableMetadataCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAthenaListTableMetadataContract } from '@/lib/api/contracts/tools/aws/athena-list-table-metadata'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaListTableMetadata')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAthenaListTableMetadataContract, request, {
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

    const command = new ListTableMetadataCommand({
      CatalogName: data.catalogName,
      DatabaseName: data.databaseName,
      ...(data.expression && { Expression: data.expression }),
      ...(data.workGroup && { WorkGroup: data.workGroup }),
      ...(data.maxResults !== undefined && { MaxResults: data.maxResults }),
      ...(data.nextToken && { NextToken: data.nextToken }),
    })

    const response = await client.send(command)

    return NextResponse.json({
      success: true,
      output: {
        tables: (response.TableMetadataList ?? []).map((table) => ({
          name: table.Name ?? '',
          tableType: table.TableType ?? null,
          createTime: table.CreateTime?.getTime() ?? null,
          lastAccessTime: table.LastAccessTime?.getTime() ?? null,
          columns: (table.Columns ?? []).map((col) => ({
            name: col.Name ?? '',
            type: col.Type ?? null,
            comment: col.Comment ?? null,
          })),
          partitionKeys: (table.PartitionKeys ?? []).map((col) => ({
            name: col.Name ?? '',
            type: col.Type ?? null,
            comment: col.Comment ?? null,
          })),
        })),
        nextToken: response.NextToken ?? null,
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to list Athena table metadata')
    logger.error('ListTableMetadata failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
