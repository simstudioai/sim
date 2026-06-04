import {
  CloudFormationClient,
  ListStackResourcesCommand,
  type StackResourceSummary,
} from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationListStackResourcesContract } from '@/lib/api/contracts/tools/aws/cloudformation-list-stack-resources'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationListStackResources')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationListStackResourcesContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

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
    const errorMessage = getErrorMessage(error, 'Failed to list CloudFormation stack resources')
    logger.error('ListStackResources failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
