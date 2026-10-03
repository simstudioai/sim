import type {
  WorkdayAssignOnboardingBody,
  WorkdayChangeJobBody,
  WorkdayCreatePrehireBody,
  WorkdayGetCompensationBody,
  WorkdayGetOrganizationsBody,
  WorkdayGetWorkerBody,
  WorkdayHireBody,
  WorkdayListWorkersBody,
  WorkdayTerminateBody,
  WorkdayUpdateWorkerBody,
} from '@/lib/api/contracts/tools/workday'
import {
  createWorkdaySoapClient,
  extractRefId,
  normalizeSoapArray,
  parseSoapBoolean,
  parseSoapNumber,
  type WorkdayCompensationDataSoap,
  type WorkdayCompensationPlanSoap,
  type WorkdayOrganizationSoap,
  type WorkdayWorkerSoap,
  wdRef,
} from '@/lib/internal/workday/client'
import { WorkdayOperationError } from '@/lib/internal/workday/errors'

interface WorkdayCredentials {
  tenantUrl: string
  tenant: string
  username: string
  password: string
}

function createClient(
  input: WorkdayCredentials,
  service: Parameters<typeof createWorkdaySoapClient>[2],
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  return createWorkdaySoapClient(
    input.tenantUrl,
    input.tenant,
    service,
    input.username,
    input.password,
    signal
  )
}

function workerSummary(worker: WorkdayWorkerSoap) {
  return {
    id: extractRefId(worker.Worker_Reference) ?? null,
    descriptor: worker.Worker_Descriptor ?? null,
    personalData: worker.Worker_Data?.Personal_Data ?? null,
    employmentData: worker.Worker_Data?.Employment_Data ?? null,
  }
}

export async function executeWorkdayGetWorker(input: WorkdayGetWorkerBody, signal?: AbortSignal) {
  const client = await createClient(input, 'humanResources', signal)
  const [result] = await client.Get_WorkersAsync({
    Request_References: {
      Worker_Reference: {
        ID: { attributes: { 'wd:type': 'Employee_ID' }, $value: input.workerId },
      },
    },
    Response_Group: {
      Include_Reference: true,
      Include_Personal_Information: true,
      Include_Employment_Information: true,
      Include_Compensation: true,
      Include_Organizations: true,
    },
  })
  signal?.throwIfAborted()
  const worker =
    normalizeSoapArray(
      result?.Response_Data?.Worker as WorkdayWorkerSoap | WorkdayWorkerSoap[] | undefined
    )[0] ?? null
  return {
    success: true as const,
    output: {
      worker: worker
        ? {
            ...workerSummary(worker),
            compensationData: worker.Worker_Data?.Compensation_Data ?? null,
            organizationData: worker.Worker_Data?.Organization_Data ?? null,
          }
        : null,
    },
  }
}

export async function executeWorkdayListWorkers(
  input: WorkdayListWorkersBody,
  signal?: AbortSignal
) {
  const client = await createClient(input, 'humanResources', signal)
  const limit = input.limit ?? 20
  const offset = input.offset ?? 0
  const page = offset > 0 ? Math.floor(offset / limit) + 1 : 1
  const [result] = await client.Get_WorkersAsync({
    Response_Filter: { Page: page, Count: limit },
    Response_Group: {
      Include_Reference: true,
      Include_Personal_Information: true,
      Include_Employment_Information: true,
    },
  })
  signal?.throwIfAborted()
  const workers = normalizeSoapArray(
    result?.Response_Data?.Worker as WorkdayWorkerSoap | WorkdayWorkerSoap[] | undefined
  ).map(workerSummary)
  const total = parseSoapNumber(result?.Response_Results?.Total_Results) ?? workers.length
  return { success: true as const, output: { workers, total } }
}

export async function executeWorkdayCreatePrehire(
  input: WorkdayCreatePrehireBody,
  signal?: AbortSignal
) {
  if (!input.email && !input.phoneNumber && !input.address) {
    throw new WorkdayOperationError(
      'At least one contact method (email, phone, or address) is required',
      400
    )
  }
  const parts = input.legalName.trim().split(/\s+/)
  const firstName = parts[0] ?? ''
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : ''
  if (!lastName) {
    throw new WorkdayOperationError('Legal name must include both a first name and last name', 400)
  }

  const contactData: Record<string, unknown> = {}
  if (input.email) {
    contactData.Email_Address_Data = [
      {
        Email_Address: input.email,
        Usage_Data: {
          Type_Data: { Type_Reference: wdRef('Communication_Usage_Type_ID', 'WORK') },
          Public: true,
        },
      },
    ]
  }
  if (input.phoneNumber) {
    contactData.Phone_Data = [
      {
        Phone_Number: input.phoneNumber,
        Phone_Device_Type_Reference: wdRef('Phone_Device_Type_ID', 'Landline'),
        Usage_Data: {
          Type_Data: { Type_Reference: wdRef('Communication_Usage_Type_ID', 'WORK') },
          Public: true,
        },
      },
    ]
  }
  if (input.address) {
    contactData.Address_Data = [
      {
        Formatted_Address: input.address,
        Usage_Data: {
          Type_Data: { Type_Reference: wdRef('Communication_Usage_Type_ID', 'WORK') },
          Public: true,
        },
      },
    ]
  }

  const client = await createClient(input, 'recruiting', signal)
  const [result] = await client.Put_ApplicantAsync({
    Applicant_Data: {
      Personal_Data: {
        Name_Data: {
          Legal_Name_Data: {
            Name_Detail_Data: {
              Country_Reference: wdRef('ISO_3166-1_Alpha-2_Code', input.countryCode ?? 'US'),
              First_Name: firstName,
              Last_Name: lastName,
            },
          },
        },
        Contact_Information_Data: contactData,
      },
    },
  })
  signal?.throwIfAborted()
  const applicantRef = result?.Applicant_Reference
  return {
    success: true as const,
    output: {
      preHireId: extractRefId(applicantRef),
      descriptor: applicantRef?.attributes?.Descriptor ?? null,
    },
  }
}

export async function executeWorkdayHire(input: WorkdayHireBody, signal?: AbortSignal) {
  const client = await createClient(input, 'staffing', signal)
  const [result] = await client.Hire_EmployeeAsync({
    Business_Process_Parameters: { Auto_Complete: true, Run_Now: true },
    Hire_Employee_Data: {
      Applicant_Reference: wdRef('Applicant_ID', input.preHireId),
      Position_Reference: wdRef('Position_ID', input.positionId),
      Hire_Date: input.hireDate,
      Hire_Employee_Event_Data: {
        Employee_Type_Reference: wdRef('Employee_Type_ID', input.employeeType ?? 'Regular'),
        First_Day_of_Work: input.hireDate,
      },
    },
  })
  signal?.throwIfAborted()
  const employeeRef = result?.Employee_Reference
  return {
    success: true as const,
    output: {
      workerId: extractRefId(employeeRef),
      employeeId: extractRefId(employeeRef),
      eventId: extractRefId(result?.Event_Reference),
      hireDate: input.hireDate,
    },
  }
}

export async function executeWorkdayUpdateWorker(
  input: WorkdayUpdateWorkerBody,
  signal?: AbortSignal
) {
  const client = await createClient(input, 'humanResources', signal)
  const [result] = await client.Change_Personal_InformationAsync({
    Business_Process_Parameters: { Auto_Complete: true, Run_Now: true },
    Change_Personal_Information_Business_Process_Data: {
      Person_Reference: wdRef('Employee_ID', input.workerId),
      Personal_Information_Data: input.fields,
    },
  })
  signal?.throwIfAborted()
  return {
    success: true as const,
    output: {
      eventId: extractRefId(result?.Personal_Information_Change_Event_Reference),
      workerId: input.workerId,
    },
  }
}

export async function executeWorkdayAssignOnboarding(
  input: WorkdayAssignOnboardingBody,
  signal?: AbortSignal
) {
  const client = await createClient(input, 'humanResources', signal)
  const [result] = await client.Put_Onboarding_Plan_AssignmentAsync({
    Onboarding_Plan_Assignment_Data: {
      Onboarding_Plan_Reference: wdRef('Onboarding_Plan_ID', input.onboardingPlanId),
      Person_Reference: wdRef('WID', input.workerId),
      Action_Event_Reference: wdRef('WID', input.actionEventId),
      Assignment_Effective_Moment: new Date().toISOString(),
      Active: true,
    },
  })
  signal?.throwIfAborted()
  return {
    success: true as const,
    output: {
      assignmentId: extractRefId(result?.Onboarding_Plan_Assignment_Reference),
      workerId: input.workerId,
      planId: input.onboardingPlanId,
    },
  }
}

export async function executeWorkdayGetOrganizations(
  input: WorkdayGetOrganizationsBody,
  signal?: AbortSignal
) {
  const client = await createClient(input, 'humanResources', signal)
  const limit = input.limit ?? 20
  const offset = input.offset ?? 0
  const page = offset > 0 ? Math.floor(offset / limit) + 1 : 1
  const [result] = await client.Get_OrganizationsAsync({
    Response_Filter: { Page: page, Count: limit },
    Request_Criteria: input.type
      ? {
          Organization_Type_Reference: {
            ID: { attributes: { 'wd:type': 'Organization_Type_ID' }, $value: input.type },
          },
        }
      : undefined,
    Response_Group: { Include_Hierarchy_Data: true },
  })
  signal?.throwIfAborted()
  const organizations = normalizeSoapArray(
    result?.Response_Data?.Organization as
      | WorkdayOrganizationSoap
      | WorkdayOrganizationSoap[]
      | undefined
  ).map((organization) => {
    const inactive = parseSoapBoolean(organization.Organization_Data?.Inactive)
    return {
      id: extractRefId(organization.Organization_Reference) ?? null,
      descriptor: organization.Organization_Descriptor ?? null,
      type: extractRefId(organization.Organization_Data?.Organization_Type_Reference) ?? null,
      subtype: extractRefId(organization.Organization_Data?.Organization_Subtype_Reference) ?? null,
      isActive: inactive == null ? null : !inactive,
    }
  })
  const total = parseSoapNumber(result?.Response_Results?.Total_Results) ?? organizations.length
  return { success: true as const, output: { organizations, total } }
}

export async function executeWorkdayChangeJob(input: WorkdayChangeJobBody, signal?: AbortSignal) {
  const changeJobDetailData: Record<string, unknown> = {
    Reason_Reference: wdRef('Change_Job_Subcategory_ID', input.reason),
  }
  if (input.newSupervisoryOrgId) {
    changeJobDetailData.Supervisory_Organization_Reference = wdRef(
      'Organization_Reference_ID',
      input.newSupervisoryOrgId
    )
  }
  if (input.newPositionId) {
    changeJobDetailData.Proposed_Position_Reference = wdRef('Position_ID', input.newPositionId)
  }
  const jobDetailsData: Record<string, unknown> = {}
  if (input.newJobProfileId) {
    jobDetailsData.Job_Profile_Reference = wdRef('Job_Profile_ID', input.newJobProfileId)
  }
  if (input.newLocationId) {
    jobDetailsData.Location_Reference = wdRef('Location_ID', input.newLocationId)
  }
  if (Object.keys(jobDetailsData).length > 0) {
    changeJobDetailData.Job_Details_Data = jobDetailsData
  }

  const client = await createClient(input, 'staffing', signal)
  const [result] = await client.Change_JobAsync({
    Business_Process_Parameters: { Auto_Complete: true, Run_Now: true },
    Change_Job_Data: {
      Worker_Reference: wdRef('Employee_ID', input.workerId),
      Effective_Date: input.effectiveDate,
      Change_Job_Detail_Data: changeJobDetailData,
    },
  })
  signal?.throwIfAborted()
  return {
    success: true as const,
    output: {
      eventId: extractRefId(result?.Event_Reference),
      workerId: input.workerId,
      effectiveDate: input.effectiveDate,
    },
  }
}

export async function executeWorkdayGetCompensation(
  input: WorkdayGetCompensationBody,
  signal?: AbortSignal
) {
  const client = await createClient(input, 'humanResources', signal)
  const [result] = await client.Get_WorkersAsync({
    Request_References: {
      Worker_Reference: {
        ID: { attributes: { 'wd:type': 'Employee_ID' }, $value: input.workerId },
      },
    },
    Response_Group: { Include_Reference: true, Include_Compensation: true },
  })
  signal?.throwIfAborted()
  const worker =
    normalizeSoapArray(
      result?.Response_Data?.Worker as WorkdayWorkerSoap | WorkdayWorkerSoap[] | undefined
    )[0] ?? null
  const compensationData = worker?.Worker_Data?.Compensation_Data
  const mapPlan = (plan: WorkdayCompensationPlanSoap) => ({
    id: extractRefId(plan.Compensation_Plan_Reference) ?? null,
    planName: plan.Compensation_Plan_Reference?.attributes?.Descriptor ?? null,
    amount:
      parseSoapNumber(plan.Amount) ??
      parseSoapNumber(plan.Per_Unit_Amount) ??
      parseSoapNumber(plan.Individual_Target_Amount) ??
      null,
    currency: extractRefId(plan.Currency_Reference) ?? null,
    frequency: extractRefId(plan.Frequency_Reference) ?? null,
  })
  const planTypeKeys: (keyof WorkdayCompensationDataSoap)[] = [
    'Employee_Base_Pay_Plan_Assignment_Data',
    'Employee_Salary_Unit_Plan_Assignment_Data',
    'Employee_Bonus_Plan_Assignment_Data',
    'Employee_Allowance_Plan_Assignment_Data',
    'Employee_Commission_Plan_Assignment_Data',
    'Employee_Stock_Plan_Assignment_Data',
    'Employee_Period_Salary_Plan_Assignment_Data',
  ]
  const compensationPlans = planTypeKeys.flatMap((key) =>
    normalizeSoapArray(compensationData?.[key]).map(mapPlan)
  )
  return { success: true as const, output: { compensationPlans } }
}

export async function executeWorkdayTerminate(input: WorkdayTerminateBody, signal?: AbortSignal) {
  const client = await createClient(input, 'staffing', signal)
  const [result] = await client.Terminate_EmployeeAsync({
    Business_Process_Parameters: { Auto_Complete: true, Run_Now: true },
    Terminate_Employee_Data: {
      Employee_Reference: wdRef('Employee_ID', input.workerId),
      Termination_Date: input.terminationDate,
      Terminate_Event_Data: {
        Primary_Reason_Reference: wdRef('Termination_Subcategory_ID', input.reason),
        Last_Day_of_Work: input.lastDayOfWork ?? input.terminationDate,
        Notification_Date: input.notificationDate ?? input.terminationDate,
      },
    },
  })
  signal?.throwIfAborted()
  return {
    success: true as const,
    output: {
      eventId: extractRefId(result?.Event_Reference),
      workerId: input.workerId,
      terminationDate: input.terminationDate,
    },
  }
}
