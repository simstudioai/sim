import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  createWorkdaySoapClient,
  extractRefId,
  normalizeSoapArray,
  type WorkdayOrganizationSoap,
} from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayGetOrganizationsAPI')

const RequestSchema = z.object({
  tenantUrl: z.string().min(1),
  tenant: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  type: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const data = RequestSchema.parse(body)

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

    const organizations = orgsArray.map((o) => ({
      id: extractRefId(o.Organization_Reference) ?? null,
      descriptor: o.Organization_Descriptor ?? null,
      type: extractRefId(o.Organization_Data?.Organization_Type_Reference) ?? null,
      subtype: extractRefId(o.Organization_Data?.Organization_Subtype_Reference) ?? null,
      isActive: o.Organization_Data?.Inactive != null ? !o.Organization_Data.Inactive : null,
    }))

    const total = result?.Response_Results?.Total_Results ?? organizations.length

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
}
