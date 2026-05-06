import { createLogger } from '@sim/logger'
import * as soap from 'soap'
import { validateWorkdayTenantUrl } from '@/lib/core/security/input-validation'

const logger = createLogger('WorkdaySoapClient')

const WORKDAY_SERVICES = {
  staffing: { name: 'Staffing', version: 'v45.1' },
  humanResources: { name: 'Human_Resources', version: 'v45.2' },
  compensation: { name: 'Compensation', version: 'v45.0' },
  recruiting: { name: 'Recruiting', version: 'v45.0' },
} as const

export type WorkdayServiceKey = keyof typeof WORKDAY_SERVICES

export interface WorkdaySoapResult {
  Response_Data?: Record<string, unknown>
  Response_Results?: {
    Total_Results?: number
    Total_Pages?: number
    Page_Results?: number
    Page?: number
  }
  Event_Reference?: WorkdayReference
  Employee_Reference?: WorkdayReference
  Position_Reference?: WorkdayReference
  Applicant_Reference?: WorkdayReference & { attributes?: { Descriptor?: string } }
  Onboarding_Plan_Assignment_Reference?: WorkdayReference
  Personal_Information_Change_Event_Reference?: WorkdayReference
  Exceptions_Response_Data?: unknown
}

export interface WorkdayReference {
  ID?: WorkdayIdEntry[] | WorkdayIdEntry
  attributes?: Record<string, string>
}

export interface WorkdayIdEntry {
  $value?: string
  _?: string
  attributes?: Record<string, string>
}

/**
 * Raw SOAP response shape for a single Worker returned by Get_Workers.
 * Fields are optional since the Response_Group controls what gets included.
 */
export interface WorkdayWorkerSoap {
  Worker_Reference?: WorkdayReference
  Worker_Descriptor?: string
  Worker_Data?: WorkdayWorkerDataSoap
}

export interface WorkdayWorkerDataSoap {
  Personal_Data?: Record<string, unknown>
  Employment_Data?: Record<string, unknown>
  Compensation_Data?: WorkdayCompensationDataSoap
  Organization_Data?: Record<string, unknown>
}

export interface WorkdayCompensationDataSoap {
  Employee_Base_Pay_Plan_Assignment_Data?:
    | WorkdayCompensationPlanSoap
    | WorkdayCompensationPlanSoap[]
  Employee_Salary_Unit_Plan_Assignment_Data?:
    | WorkdayCompensationPlanSoap
    | WorkdayCompensationPlanSoap[]
  Employee_Bonus_Plan_Assignment_Data?: WorkdayCompensationPlanSoap | WorkdayCompensationPlanSoap[]
  Employee_Allowance_Plan_Assignment_Data?:
    | WorkdayCompensationPlanSoap
    | WorkdayCompensationPlanSoap[]
  Employee_Commission_Plan_Assignment_Data?:
    | WorkdayCompensationPlanSoap
    | WorkdayCompensationPlanSoap[]
  Employee_Stock_Plan_Assignment_Data?: WorkdayCompensationPlanSoap | WorkdayCompensationPlanSoap[]
  Employee_Period_Salary_Plan_Assignment_Data?:
    | WorkdayCompensationPlanSoap
    | WorkdayCompensationPlanSoap[]
}

export interface WorkdayCompensationPlanSoap {
  Compensation_Plan_Reference?: WorkdayReference
  Amount?: number
  Per_Unit_Amount?: number
  Individual_Target_Amount?: number
  Currency_Reference?: WorkdayReference
  Frequency_Reference?: WorkdayReference
}

/**
 * Raw SOAP response shape for a single Organization returned by Get_Organizations.
 */
export interface WorkdayOrganizationSoap {
  Organization_Reference?: WorkdayReference
  Organization_Descriptor?: string
  Organization_Data?: WorkdayOrganizationDataSoap
}

export interface WorkdayOrganizationDataSoap {
  Organization_Type_Reference?: WorkdayReference
  Organization_Subtype_Reference?: WorkdayReference
  Inactive?: boolean
}

/**
 * Normalizes a SOAP response field that may be a single object, an array, or undefined
 * into a consistently typed array.
 */
export function normalizeSoapArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

type SoapOperationFn = (
  args: Record<string, unknown>
) => Promise<[WorkdaySoapResult, string, Record<string, unknown>, string]>

export interface WorkdayClient extends soap.Client {
  Get_WorkersAsync: SoapOperationFn
  Get_OrganizationsAsync: SoapOperationFn
  Put_ApplicantAsync: SoapOperationFn
  Hire_EmployeeAsync: SoapOperationFn
  Change_JobAsync: SoapOperationFn
  Terminate_EmployeeAsync: SoapOperationFn
  Change_Personal_InformationAsync: SoapOperationFn
  Put_Onboarding_Plan_AssignmentAsync: SoapOperationFn
}

/**
 * Builds the WSDL URL for a Workday SOAP service.
 * Pattern: {tenantUrl}/ccx/service/{tenant}/{serviceName}/{version}?wsdl
 *
 * @throws Error if tenantUrl is not a trusted Workday-hosted URL (SSRF guard)
 */
export function buildWsdlUrl(
  tenantUrl: string,
  tenant: string,
  service: WorkdayServiceKey
): string {
  const validation = validateWorkdayTenantUrl(tenantUrl)
  if (!validation.isValid) {
    throw new Error(validation.error ?? 'Invalid tenantUrl')
  }
  const svc = WORKDAY_SERVICES[service]
  const baseUrl = (validation.sanitized ?? tenantUrl).replace(/\/$/, '')
  return `${baseUrl}/ccx/service/${tenant}/${svc.name}/${svc.version}?wsdl`
}

/**
 * Creates a typed SOAP client for a Workday service.
 * Uses the `soap` npm package to parse the WSDL and auto-marshall JSON to XML.
 */
export async function createWorkdaySoapClient(
  tenantUrl: string,
  tenant: string,
  service: WorkdayServiceKey,
  username: string,
  password: string
): Promise<WorkdayClient> {
  const wsdlUrl = buildWsdlUrl(tenantUrl, tenant, service)
  logger.info('Creating Workday SOAP client', { service, wsdlUrl })

  const client = await soap.createClientAsync(wsdlUrl)
  client.setSecurity(new soap.BasicAuthSecurity(username, password))
  return client as WorkdayClient
}

/**
 * Builds a Workday object reference in the format the SOAP API expects.
 * Generates: { ID: { attributes: { type: idType }, $value: idValue } }
 */
export function wdRef(idType: string, idValue: string): { ID: WorkdayIdEntry } {
  return {
    ID: {
      attributes: { 'wd:type': idType },
      $value: idValue,
    },
  }
}

/**
 * Extracts a reference ID from a SOAP response object.
 * Handles the nested ID structure that Workday returns.
 */
export function extractRefId(ref: WorkdayReference | undefined): string | null {
  if (!ref) return null
  const id = ref.ID
  if (Array.isArray(id)) {
    return id[0]?.$value ?? id[0]?._ ?? null
  }
  if (id && typeof id === 'object') {
    return id.$value ?? id._ ?? null
  }
  return null
}
