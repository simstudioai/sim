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

const workdayToolResponseSchema = z.object({}).passthrough()

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
  response: { mode: 'json', schema: workdayToolResponseSchema },
})

export const workdayListWorkersContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/list-workers',
  body: workdayListWorkersBodySchema,
  response: { mode: 'json', schema: workdayToolResponseSchema },
})

export const workdayCreatePrehireContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/create-prehire',
  body: workdayCreatePrehireBodySchema,
  response: { mode: 'json', schema: workdayToolResponseSchema },
})

export const workdayHireContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/hire',
  body: workdayHireBodySchema,
  response: { mode: 'json', schema: workdayToolResponseSchema },
})

export const workdayUpdateWorkerContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/update-worker',
  body: workdayUpdateWorkerBodySchema,
  response: { mode: 'json', schema: workdayToolResponseSchema },
})

export const workdayAssignOnboardingContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/assign-onboarding',
  body: workdayAssignOnboardingBodySchema,
  response: { mode: 'json', schema: workdayToolResponseSchema },
})

export const workdayGetOrganizationsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/get-organizations',
  body: workdayGetOrganizationsBodySchema,
  response: { mode: 'json', schema: workdayToolResponseSchema },
})

export const workdayChangeJobContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/change-job',
  body: workdayChangeJobBodySchema,
  response: { mode: 'json', schema: workdayToolResponseSchema },
})

export const workdayGetCompensationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/get-compensation',
  body: workdayGetCompensationBodySchema,
  response: { mode: 'json', schema: workdayToolResponseSchema },
})

export const workdayTerminateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/workday/terminate',
  body: workdayTerminateBodySchema,
  response: { mode: 'json', schema: workdayToolResponseSchema },
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
