import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamSimulatePrincipalPolicyContract } from '@/lib/api/contracts/tools/aws/iam-simulate-principal-policy'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, simulatePrincipalPolicy } from '../utils'

const logger = createLogger('IAMSimulatePrincipalPolicyAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamSimulatePrincipalPolicyContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `Simulating principal policy for "${params.policySourceArn}" on actions: ${params.actionNames}`
    )

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await simulatePrincipalPolicy(
        client,
        params.policySourceArn,
        params.actionNames,
        params.resourceArns,
        params.maxResults,
        params.marker
      )
      logger.info(`Simulation complete: ${result.count} results`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to simulate principal policy:`, error)
    return NextResponse.json(
      { error: `Failed to simulate principal policy: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
