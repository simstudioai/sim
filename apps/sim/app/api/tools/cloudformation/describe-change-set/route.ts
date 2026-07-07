import { CloudFormationClient, DescribeChangeSetCommand } from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationDescribeChangeSetContract } from '@/lib/api/contracts/tools/aws/cloudformation-describe-change-set'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationDescribeChangeSet')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationDescribeChangeSetContract, request, {
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

    const command = new DescribeChangeSetCommand({
      ChangeSetName: validatedData.changeSetName,
      ...(validatedData.stackName && { StackName: validatedData.stackName }),
    })

    const response = await client.send(command)

    const changes = (response.Changes ?? []).map((c) => ({
      action: c.ResourceChange?.Action,
      logicalResourceId: c.ResourceChange?.LogicalResourceId,
      physicalResourceId: c.ResourceChange?.PhysicalResourceId,
      resourceType: c.ResourceChange?.ResourceType,
      replacement: c.ResourceChange?.Replacement,
    }))

    return NextResponse.json({
      success: true,
      output: {
        changeSetName: response.ChangeSetName,
        changeSetId: response.ChangeSetId,
        stackId: response.StackId,
        stackName: response.StackName,
        description: response.Description,
        executionStatus: response.ExecutionStatus,
        status: response.Status,
        statusReason: response.StatusReason,
        creationTime: response.CreationTime?.getTime(),
        capabilities: response.Capabilities ?? [],
        changes,
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to describe CloudFormation change set')
    logger.error('DescribeChangeSet failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
