import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { workdayGetOrganizationsContract } from '@/lib/api/contracts/tools/workday'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createWorkdaySoapClient,
  extractRefId,
  normalizeSoapArray,
  parseSoapBoolean,
  parseSoapNumber,
  type WorkdayOrganizationSoap,
} from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayGetOrganizationsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(workdayGetOrganizationsContract, request, {})
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    const client = await createWorkdaySoapClient(
      data.tenantUrl,
      data.tenant,
      'humanResources',
      data.username,
      data.password
    )

    const limit = data.limit ?? 20
    const offset = data.offset ?? 0
    const page = offset > 0 ? Math.floor(offset / limit) + 1 : 1

    const [result] = await client.Get_OrganizationsAsync({
      Response_Filter: { Page: page, Count: limit },
      Request_Criteria: data.type
        ? {
            Organization_Type_Reference: {
              ID: {
                attributes: { 'wd:type': 'Organization_Type_ID' },
                $value: data.type,
              },
            },
          }
        : undefined,
      Response_Group: { Include_Hierarchy_Data: true },
    })

    const orgsArray = normalizeSoapArray(
      result?.Response_Data?.Organization as
        | WorkdayOrganizationSoap
        | WorkdayOrganizationSoap[]
        | undefined
    )

    const organizations = orgsArray.map((o) => {
      const inactive = parseSoapBoolean(o.Organization_Data?.Inactive)
      return {
        id: extractRefId(o.Organization_Reference) ?? null,
        descriptor: o.Organization_Descriptor ?? null,
        type: extractRefId(o.Organization_Data?.Organization_Type_Reference) ?? null,
        subtype: extractRefId(o.Organization_Data?.Organization_Subtype_Reference) ?? null,
        isActive: inactive == null ? null : !inactive,
      }
    })

    const total = parseSoapNumber(result?.Response_Results?.Total_Results) ?? organizations.length

    return NextResponse.json({
      success: true,
      output: { organizations, total },
    })
  } catch (error) {
    logger.error(`[${requestId}] Workday get organizations failed`, { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
})
