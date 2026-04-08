import { CreateNamedQueryCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaCreateNamedQuery')

const CreateNamedQuerySchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  name: z.string().min(1, 'Query name is required'),
  database: z.string().min(1, 'Database is required'),
  queryString: z.string().min(1, 'Query string is required'),
  description: z.string().optional(),
  workGroup: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const data = CreateNamedQuerySchema.parse(body)

    const client = createAthenaClient({
      region: data.region,
      accessKeyId: data.accessKeyId,
      secretAccessKey: data.secretAccessKey,
    })

    const command = new CreateNamedQueryCommand({
      Name: data.name,
      Database: data.database,
      QueryString: data.queryString,
      ...(data.description && { Description: data.description }),
      ...(data.workGroup && { WorkGroup: data.workGroup }),
    })

    const response = await client.send(command)

    if (!response.NamedQueryId) {
      throw new Error('No named query ID returned')
    }

    return NextResponse.json({
      success: true,
      output: {
        namedQueryId: response.NamedQueryId,
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
      error instanceof Error ? error.message : 'Failed to create Athena named query'
    logger.error('CreateNamedQuery failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
