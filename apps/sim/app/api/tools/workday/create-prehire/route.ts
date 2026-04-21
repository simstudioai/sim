import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createWorkdaySoapClient, extractRefId, wdRef } from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayCreatePrehireAPI')

const RequestSchema = z.object({
  tenantUrl: z.string().min(1),
  tenant: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  legalName: z.string().min(1),
  email: z.string().optional(),
  phoneNumber: z.string().optional(),
  address: z.string().optional(),
  countryCode: z.string().optional(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const data = RequestSchema.parse(body)

    if (!data.email && !data.phoneNumber && !data.address) {
      return NextResponse.json(
        {
          success: false,
          error: 'At least one contact method (email, phone, or address) is required',
        },
        { status: 400 }
      )
    }

    const parts = data.legalName.trim().split(/\s+/)
    const firstName = parts[0] ?? ''
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : ''

    if (!lastName) {
      return NextResponse.json(
        { success: false, error: 'Legal name must include both a first name and last name' },
        { status: 400 }
      )
    }

    const client = await createWorkdaySoapClient(
      data.tenantUrl,
      data.tenant,
      'staffing',
      data.username,
      data.password
    )

    const contactData: Record<string, unknown> = {}
    if (data.email) {
      contactData.Email_Address_Data = [
        {
          Email_Address: data.email,
          Usage_Data: {
            Type_Data: { Type_Reference: wdRef('Communication_Usage_Type_ID', 'WORK') },
            Public: true,
          },
        },
      ]
    }
    if (data.phoneNumber) {
      contactData.Phone_Data = [
        {
          Phone_Number: data.phoneNumber,
          Phone_Device_Type_Reference: wdRef('Phone_Device_Type_ID', 'Landline'),
          Usage_Data: {
            Type_Data: { Type_Reference: wdRef('Communication_Usage_Type_ID', 'WORK') },
            Public: true,
          },
        },
      ]
    }
    if (data.address) {
      contactData.Address_Data = [
        {
          Formatted_Address: data.address,
          Usage_Data: {
            Type_Data: { Type_Reference: wdRef('Communication_Usage_Type_ID', 'WORK') },
            Public: true,
          },
        },
      ]
    }

    const [result] = await client.Put_ApplicantAsync({
      Applicant_Data: {
        Personal_Data: {
          Name_Data: {
            Legal_Name_Data: {
              Name_Detail_Data: {
                Country_Reference: wdRef('ISO_3166-1_Alpha-2_Code', data.countryCode ?? 'US'),
                First_Name: firstName,
                Last_Name: lastName,
              },
            },
          },
          Contact_Information_Data: contactData,
        },
      },
    })

    const applicantRef = result?.Applicant_Reference

    return NextResponse.json({
      success: true,
      output: {
        preHireId: extractRefId(applicantRef),
        descriptor: applicantRef?.attributes?.Descriptor ?? null,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Workday create prehire failed`, { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
})
