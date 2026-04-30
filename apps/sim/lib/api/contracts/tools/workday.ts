import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const workdayBaseBodySchema = z.object({
  tenantUrl: z.string().min(1),
  tenant: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
})

const nullableStringSchema = z.string().nullable()
const workdayTotalSchema = z.union([z.number(), z.string()])

const workdayWorkerSummarySchema = z.object({
  id: nullableStringSchema,
  descriptor: nullableStringSchema,
  personalData: z.unknown().nullable(),
  employmentData: z.unknown().nullable(),
  compensationData: z.unknown().nullable().optional(),
  organizationData: z.unknown().nullable().optional(),
})

const workdayOrganizationSchema = z.object({
  id: nullableStringSchema,
  descriptor: nullableStringSchema,
  type: nullableStringSchema,
  subtype: nullableStringSchema,
  isActive: z.boolean().nullable(),
})

const workdayCompensationPlanSchema = z.object({
  id: nullableStringSchema,
  planName: nullableStringSchema,
  amount: z.unknown().nullable(),
  currency: nullableStringSchema,
  frequency: nullableStringSchema,
})

const workdaySuccessOutputSchema = <T extends z.ZodType>(output: T) =>
  z.object({
    success: z.literal(true),
    output,
  })

const workdayEventIdSchema = z.string().nullable()

const workdayGetWorkerResponseSchema = workdaySuccessOutputSchema(
  z.object({ worker: workdayWorkerSummarySchema.nullable() })
)
const workdayListWorkersResponseSchema = workdaySuccessOutputSchema(
  z.object({ workers: z.array(workdayWorkerSummarySchema), total: workdayTotalSchema })
)
const workdayCreatePrehireResponseSchema = workdaySuccessOutputSchema(
  z.object({ preHireId: nullableStringSchema, descriptor: nullableStringSchema })
)
const workdayHireResponseSchema = workdaySuccessOutputSchema(
  z.object({
    workerId: nullableStringSchema,
    employeeId: nullableStringSchema,
    eventId: workdayEventIdSchema,
    hireDate: z.string(),
  })
)
const workdayUpdateWorkerResponseSchema = workdaySuccessOutputSchema(
  z.object({ eventId: workdayEventIdSchema, workerId: z.string() })
)
const workdayAssignOnboardingResponseSchema = workdaySuccessOutputSchema(
  z.object({
    assignmentId: nullableStringSchema,
    workerId: z.string(),
    planId: z.string(),
  })
)
const workdayGetOrganizationsResponseSchema = workdaySuccessOutputSchema(
  z.object({ organizations: z.array(workdayOrganizationSchema), total: workdayTotalSchema })
)
const workdayChangeJobResponseSchema = workdaySuccessOutputSchema(
  z.object({ eventId: workdayEventIdSchema, workerId: z.string(), effectiveDate: z.string() })
)
const workdayGetCompensationResponseSchema = workdaySuccessOutputSchema(
  z.object({ compensationPlans: z.array(workdayCompensationPlanSchema) })
)
const workdayTerminateResponseSchema = workdaySuccessOutputSchema(
  z.object({ eventId: workdayEventIdSchema, workerId: z.string(), terminationDate: z.string() })
)

export const workdayGetWorkerBodySchema = workdayBaseBodySchema.extend({
  workerId: z.string().min(1),
})

export const workdayListWorkersBodySchema = workdayBaseBodySchema.extend({
  limit: z.number().optional(),
  offset: z.number().optional(),
})

export const workdayCreatePrehireBodySchema = workdayBaseBodySchema.extend({
  legalName: z.string().min(1),
  email: z.string().optional(),
  phoneNumber: z.string().optional(),
  address: z.string().optional(),
  countryCode: z.string().optional(),
})

export const workdayHireBodySchema = workdayBaseBodySchema.extend({
  preHireId: z.string().min(1),
  positionId: z.string().min(1),
  hireDate: z.string().min(1),
  employeeType: z.string().optional(),
})

export const workdayUpdateWorkerBodySchema = workdayBaseBodySchema.extend({
  workerId: z.string().min(1),
  fields: z.record(z.string(), z.unknown()),
})

export const workdayAssignOnboardingBodySchema = workdayBaseBodySchema.extend({
  workerId: z.string().min(1),
  onboardingPlanId: z.string().min(1),
  actionEventId: z.string().min(1),
})

export const workdayGetOrganizationsBodySchema = workdayBaseBodySchema.extend({
  type: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
})

export const workdayChangeJobBodySchema = workdayBaseBodySchema.extend({
  workerId: z.string().min(1),
  effectiveDate: z.string().min(1),
  newPositionId: z.string().optional(),
  newJobProfileId: z.string().optional(),
  newLocationId: z.string().optional(),
  newSupervisoryOrgId: z.string().optional(),
  reason: z.string().min(1, 'Reason is required for job changes'),
})

export const workdayGetCompensationBodySchema = workdayBaseBodySchema.extend({
  workerId: z.string().min(1),
})

export const workdayTerminateBodySchema = workdayBaseBodySchema.extend({
  workerId: z.string().min(1),
  terminationDate: z.string().min(1),
  reason: z.string().min(1),
  notificationDate: z.string().optional(),
  lastDayOfWork: z.string().optional(),
})

export const workdayGetWorkerContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/get-worker',
  body: workdayGetWorkerBodySchema,
  response: { mode: 'json', schema: workdayGetWorkerResponseSchema },
})

export const workdayListWorkersContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/list-workers',
  body: workdayListWorkersBodySchema,
  response: { mode: 'json', schema: workdayListWorkersResponseSchema },
})

export const workdayCreatePrehireContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/create-prehire',
  body: workdayCreatePrehireBodySchema,
  response: { mode: 'json', schema: workdayCreatePrehireResponseSchema },
})

export const workdayHireContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/hire',
  body: workdayHireBodySchema,
  response: { mode: 'json', schema: workdayHireResponseSchema },
})

export const workdayUpdateWorkerContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/update-worker',
  body: workdayUpdateWorkerBodySchema,
  response: { mode: 'json', schema: workdayUpdateWorkerResponseSchema },
})

export const workdayAssignOnboardingContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/assign-onboarding',
  body: workdayAssignOnboardingBodySchema,
  response: { mode: 'json', schema: workdayAssignOnboardingResponseSchema },
})

export const workdayGetOrganizationsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/get-organizations',
  body: workdayGetOrganizationsBodySchema,
  response: { mode: 'json', schema: workdayGetOrganizationsResponseSchema },
})

export const workdayChangeJobContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/change-job',
  body: workdayChangeJobBodySchema,
  response: { mode: 'json', schema: workdayChangeJobResponseSchema },
})

export const workdayGetCompensationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/get-compensation',
  body: workdayGetCompensationBodySchema,
  response: { mode: 'json', schema: workdayGetCompensationResponseSchema },
})

export const workdayTerminateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/terminate',
  body: workdayTerminateBodySchema,
  response: { mode: 'json', schema: workdayTerminateResponseSchema },
})

export type WorkdayGetWorkerBody = ContractBody<typeof workdayGetWorkerContract>
export type WorkdayGetWorkerBodyInput = ContractBodyInput<typeof workdayGetWorkerContract>
export type WorkdayGetWorkerResponse = ContractJsonResponse<typeof workdayGetWorkerContract>
export type WorkdayListWorkersBody = ContractBody<typeof workdayListWorkersContract>
export type WorkdayListWorkersBodyInput = ContractBodyInput<typeof workdayListWorkersContract>
export type WorkdayListWorkersResponse = ContractJsonResponse<typeof workdayListWorkersContract>
export type WorkdayCreatePrehireBody = ContractBody<typeof workdayCreatePrehireContract>
export type WorkdayCreatePrehireBodyInput = ContractBodyInput<typeof workdayCreatePrehireContract>
export type WorkdayCreatePrehireResponse = ContractJsonResponse<typeof workdayCreatePrehireContract>
export type WorkdayHireBody = ContractBody<typeof workdayHireContract>
export type WorkdayHireBodyInput = ContractBodyInput<typeof workdayHireContract>
export type WorkdayHireResponse = ContractJsonResponse<typeof workdayHireContract>
export type WorkdayUpdateWorkerBody = ContractBody<typeof workdayUpdateWorkerContract>
export type WorkdayUpdateWorkerBodyInput = ContractBodyInput<typeof workdayUpdateWorkerContract>
export type WorkdayUpdateWorkerResponse = ContractJsonResponse<typeof workdayUpdateWorkerContract>
export type WorkdayAssignOnboardingBody = ContractBody<typeof workdayAssignOnboardingContract>
export type WorkdayAssignOnboardingBodyInput = ContractBodyInput<
  typeof workdayAssignOnboardingContract
>
export type WorkdayAssignOnboardingResponse = ContractJsonResponse<
  typeof workdayAssignOnboardingContract
>
export type WorkdayGetOrganizationsBody = ContractBody<typeof workdayGetOrganizationsContract>
export type WorkdayGetOrganizationsBodyInput = ContractBodyInput<
  typeof workdayGetOrganizationsContract
>
export type WorkdayGetOrganizationsResponse = ContractJsonResponse<
  typeof workdayGetOrganizationsContract
>
export type WorkdayChangeJobBody = ContractBody<typeof workdayChangeJobContract>
export type WorkdayChangeJobBodyInput = ContractBodyInput<typeof workdayChangeJobContract>
export type WorkdayChangeJobResponse = ContractJsonResponse<typeof workdayChangeJobContract>
export type WorkdayGetCompensationBody = ContractBody<typeof workdayGetCompensationContract>
export type WorkdayGetCompensationBodyInput = ContractBodyInput<
  typeof workdayGetCompensationContract
>
export type WorkdayGetCompensationResponse = ContractJsonResponse<
  typeof workdayGetCompensationContract
>
export type WorkdayTerminateBody = ContractBody<typeof workdayTerminateContract>
export type WorkdayTerminateBodyInput = ContractBodyInput<typeof workdayTerminateContract>
export type WorkdayTerminateResponse = ContractJsonResponse<typeof workdayTerminateContract>
