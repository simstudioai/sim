import type { ToolResponse } from '@/tools/types'

export interface WorkdayBaseParams {
  tenantUrl: string
  tenant: string
  username: string
  password: string
}

export interface WorkdayWorker {
  id: string
  descriptor: string
  primaryWorkEmail?: string
  primaryWorkPhone?: string
  businessTitle?: string
  supervisoryOrganization?: string
  hireDate?: string
  workerType?: string
  isActive?: boolean
  [key: string]: unknown
}

export interface WorkdayOrganization {
  id: string
  descriptor: string
  type?: string
  subtype?: string
  isActive?: boolean
  [key: string]: unknown
}

/** Get Worker */
export interface WorkdayGetWorkerParams extends WorkdayBaseParams {
  workerId: string
}

export interface WorkdayGetWorkerResponse extends ToolResponse {
  output: {
    worker: WorkdayWorker
  }
}

/** List Workers */
export interface WorkdayListWorkersParams extends WorkdayBaseParams {
  limit?: number
  offset?: number
}

export interface WorkdayListWorkersResponse extends ToolResponse {
  output: {
    workers: WorkdayWorker[]
    total: number
  }
}

/** Create Pre-Hire */
export interface WorkdayCreatePrehireParams extends WorkdayBaseParams {
  legalName: string
  email?: string
  phoneNumber?: string
  address?: string
  countryCode?: string
}

export interface WorkdayCreatePrehireResponse extends ToolResponse {
  output: {
    preHireId: string
    descriptor: string
  }
}

/** Hire Employee */
export interface WorkdayHireEmployeeParams extends WorkdayBaseParams {
  preHireId: string
  positionId: string
  hireDate: string
  employeeType?: string
}

export interface WorkdayHireEmployeeResponse extends ToolResponse {
  output: {
    workerId: string
    employeeId: string
    eventId: string
    hireDate: string
  }
}

/** Update Worker */
export interface WorkdayUpdateWorkerParams extends WorkdayBaseParams {
  workerId: string
  fields: Record<string, unknown>
}

export interface WorkdayUpdateWorkerResponse extends ToolResponse {
  output: {
    eventId: string
    workerId: string
  }
}

/** Assign Onboarding Plan */
export interface WorkdayAssignOnboardingParams extends WorkdayBaseParams {
  workerId: string
  onboardingPlanId: string
  actionEventId: string
}

export interface WorkdayAssignOnboardingResponse extends ToolResponse {
  output: {
    assignmentId: string
    workerId: string
    planId: string
  }
}

/** Get Organizations */
export interface WorkdayGetOrganizationsParams extends WorkdayBaseParams {
  type?: string
  limit?: number
  offset?: number
}

export interface WorkdayGetOrganizationsResponse extends ToolResponse {
  output: {
    organizations: WorkdayOrganization[]
    total: number
  }
}

/** Change Job */
export interface WorkdayChangeJobParams extends WorkdayBaseParams {
  workerId: string
  effectiveDate: string
  newPositionId?: string
  newJobProfileId?: string
  newLocationId?: string
  newSupervisoryOrgId?: string
  reason: string
}

export interface WorkdayChangeJobResponse extends ToolResponse {
  output: {
    eventId: string
    workerId: string
    effectiveDate: string
  }
}

/** Get Compensation */
export interface WorkdayGetCompensationParams extends WorkdayBaseParams {
  workerId: string
}

export interface WorkdayGetCompensationResponse extends ToolResponse {
  output: {
    compensationPlans: Array<{
      id: string
      planName: string
      amount: number
      currency: string
      frequency: string
      [key: string]: unknown
    }>
  }
}

/** Terminate Worker */
export interface WorkdayTerminateWorkerParams extends WorkdayBaseParams {
  workerId: string
  terminationDate: string
  reason: string
  notificationDate?: string
  lastDayOfWork?: string
}

export interface WorkdayTerminateWorkerResponse extends ToolResponse {
  output: {
    eventId: string
    workerId: string
    terminationDate: string
  }
}
