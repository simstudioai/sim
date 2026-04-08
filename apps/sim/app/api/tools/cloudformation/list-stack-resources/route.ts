import {
  CloudFormationClient,
  ListStackResourcesCommand,
  type StackResourceSummary,
} from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'

const logger = createLogger('CloudFormationListStackResources')

const ListStackResourcesSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  stackName: z.string().min(1, 'Stack name is required'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = ListStackResourcesSchema.parse(body)

    const client = new CloudFormationClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    const allSummaries: StackResourceSummary[] = []
    let nextToken: string | undefined
    do {
      const command = new ListStackResourcesCommand({
        StackName: validatedData.stackName,
        ...(nextToken && { NextToken: nextToken }),
      })
      const response = await client.send(command)
      allSummaries.push(...(response.StackResourceSummaries ?? []))
      nextToken = response.NextToken
    } while (nextToken)

    const resources = allSummaries.map((r) => ({
      logicalResourceId: r.LogicalResourceId ?? '',
      physicalResourceId: r.PhysicalResourceId,
      resourceType: r.ResourceType ?? '',
      resourceStatus: r.ResourceStatus ?? 'UNKNOWN',
      resourceStatusReason: r.ResourceStatusReason,
      lastUpdatedTimestamp: r.LastUpdatedTimestamp?.getTime(),
      driftInformation: r.DriftInformation
        ? {
            stackResourceDriftStatus: r.DriftInformation.StackResourceDriftStatus,
            lastCheckTimestamp: r.DriftInformation.LastCheckTimestamp?.getTime(),
          }
        : null,
    }))

    return NextResponse.json({
      success: true,
      output: { resources },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to list CloudFormation stack resources'
    logger.error('ListStackResources failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
