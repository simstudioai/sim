import { createLogger } from '@sim/logger'
import * as soap from 'soap'

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

interface WorkdayIdEntry {
  $value?: string
  _?: string
  attributes?: Record<string, string>
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
 */
export function buildWsdlUrl(
  tenantUrl: string,
  tenant: string,
  service: WorkdayServiceKey
): string {
  const svc = WORKDAY_SERVICES[service]
  const baseUrl = tenantUrl.replace(/\/$/, '')
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
