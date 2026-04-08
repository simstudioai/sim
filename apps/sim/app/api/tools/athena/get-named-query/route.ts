import { GetNamedQueryCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaGetNamedQuery')

const GetNamedQuerySchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  namedQueryId: z.string().min(1, 'Named query ID is required'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const data = GetNamedQuerySchema.parse(body)

    const client = createAthenaClient({
      region: data.region,
      accessKeyId: data.accessKeyId,
      secretAccessKey: data.secretAccessKey,
    })

    const command = new GetNamedQueryCommand({
      NamedQueryId: data.namedQueryId,
    })

    const response = await client.send(command)
    const namedQuery = response.NamedQuery

    if (!namedQuery) {
      throw new Error('No named query data returned')
    }

    return NextResponse.json({
      success: true,
      output: {
        namedQueryId: namedQuery.NamedQueryId ?? data.namedQueryId,
        name: namedQuery.Name ?? '',
        description: namedQuery.Description ?? null,
        database: namedQuery.Database ?? '',
        queryString: namedQuery.QueryString ?? '',
        workGroup: namedQuery.WorkGroup ?? null,
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get Athena named query'
    logger.error('GetNamedQuery failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
