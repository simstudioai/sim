import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { validateWorkdayTenantUrl } from '@/lib/core/security/input-validation'

const logger = createLogger('WorkdaySoapClient')

const WORKDAY_SERVICES = {
  staffing: { name: 'Staffing', version: 'v45.1' },
  humanResources: { name: 'Human_Resources', version: 'v45.2' },
  compensation: { name: 'Compensation', version: 'v45.0' },
  recruiting: { name: 'Recruiting', version: 'v45.0' },
} as const

export type WorkdayServiceKey = keyof typeof WORKDAY_SERVICES

interface WorkdaySoapResult {
  Response_Data?: Record<string, unknown>
  Response_Results?: {
    Total_Results?: number | string
    Total_Pages?: number | string
    Page_Results?: number | string
    Page?: number | string
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

interface WorkdayWorkerDataSoap {
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
  Amount?: number | string
  Per_Unit_Amount?: number | string
  Individual_Target_Amount?: number | string
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

interface WorkdayOrganizationDataSoap {
  Organization_Type_Reference?: WorkdayReference
  Organization_Subtype_Reference?: WorkdayReference
  Inactive?: boolean | string
}

/**
 * Normalizes a SOAP response field that may be a single object, an array, or undefined
 * into a consistently typed array.
 */
export function normalizeSoapArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Coerces a SOAP scalar to a boolean. The XML parser returns leaf text as strings,
 * so `"true"`/`"false"` must be normalized before boolean operations like negation.
 * Returns null when the value is null/undefined or unrecognized.
 */
export function parseSoapBoolean(value: unknown): boolean | null {
  if (value == null) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase()
    if (trimmed === 'true' || trimmed === '1') return true
    if (trimmed === 'false' || trimmed === '0') return false
  }
  return null
}

/**
 * Coerces a SOAP scalar to a number. The XML parser returns leaf text as strings,
 * so numeric fields like `Total_Results` must be normalized before arithmetic.
 * Returns null when the value is null/undefined or not a finite number.
 */
export function parseSoapNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const WD_OPERATIONS = [
  'Get_Workers',
  'Get_Organizations',
  'Put_Applicant',
  'Hire_Employee',
  'Change_Job',
  'Terminate_Employee',
  'Change_Personal_Information',
  'Put_Onboarding_Plan_Assignment',
] as const

type WorkdayOperation = (typeof WD_OPERATIONS)[number]

type SoapOperationFn = (
  args: Record<string, unknown>
) => Promise<[WorkdaySoapResult, string, Record<string, unknown>, string]>

export interface WorkdayClient {
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
 * Builds the service endpoint URL for a Workday SOAP service.
 * Pattern: {tenantUrl}/ccx/service/{tenant}/{serviceName}/{version}
 *
 * @throws Error if tenantUrl is not a trusted Workday-hosted URL (SSRF guard)
 */
export function buildServiceUrl(
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
  return `${baseUrl}/ccx/service/${tenant}/${svc.name}/${svc.version}`
}

/**
 * Builds the WSDL URL for a Workday SOAP service. Retained for backwards compatibility
 * with any external consumers; the runtime no longer fetches the WSDL.
 */
export function buildWsdlUrl(
  tenantUrl: string,
  tenant: string,
  service: WorkdayServiceKey
): string {
  return `${buildServiceUrl(tenantUrl, tenant, service)}?wsdl`
}

const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ENTITIES[c] ?? c)
}

function serializeAttributes(attrs?: Record<string, string>): string {
  if (!attrs) return ''
  let out = ''
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue
    out += ` ${k}="${escapeXml(String(v))}"`
  }
  return out
}

/**
 * Marshals a JS value into XML under the `wd:` namespace.
 * Conventions:
 *  - Plain objects become elements with named children
 *  - `attributes` becomes element attributes
 *  - `$value` (or `_`) provides the element text content
 *  - Arrays produce repeated elements with the same name
 *  - Booleans render as "true"/"false", numbers via String()
 */
function marshal(name: string, value: unknown): string {
  if (value === undefined || value === null) return ''
  const tag = `wd:${name}`

  if (Array.isArray(value)) {
    let out = ''
    for (const item of value) {
      out += marshal(name, item)
    }
    return out
  }

  if (value instanceof Date) {
    return `<${tag}>${value.toISOString()}</${tag}>`
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const attrs = obj.attributes as Record<string, string> | undefined
    const text = (obj.$value ?? obj._) as string | number | boolean | undefined

    if (text !== undefined) {
      const childKeys = Object.keys(obj).filter(
        (k) => k !== 'attributes' && k !== '$value' && k !== '_'
      )
      if (childKeys.length === 0) {
        return `<${tag}${serializeAttributes(attrs)}>${escapeXml(String(text))}</${tag}>`
      }
    }

    let inner = ''
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'attributes' || k === '$value' || k === '_') continue
      inner += marshal(k, v)
    }
    if (text !== undefined) inner = escapeXml(String(text)) + inner
    return `<${tag}${serializeAttributes(attrs)}>${inner}</${tag}>`
  }

  if (typeof value === 'boolean') {
    return `<${tag}>${value ? 'true' : 'false'}</${tag}>`
  }

  return `<${tag}>${escapeXml(String(value))}</${tag}>`
}

function buildEnvelope(
  operation: string,
  args: Record<string, unknown>,
  username: string,
  password: string
): string {
  let body = ''
  for (const [k, v] of Object.entries(args)) {
    body += marshal(k, v)
  }

  const wsseNs = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
  const wssePwdType =
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText'

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wd="urn:com.workday/bsvc">` +
    `<env:Header>` +
    `<wsse:Security xmlns:wsse="${wsseNs}" env:mustUnderstand="1">` +
    `<wsse:UsernameToken>` +
    `<wsse:Username>${escapeXml(username)}</wsse:Username>` +
    `<wsse:Password Type="${wssePwdType}">${escapeXml(password)}</wsse:Password>` +
    `</wsse:UsernameToken>` +
    `</wsse:Security>` +
    `</env:Header>` +
    `<env:Body>` +
    `<wd:${operation}_Request>` +
    body +
    `</wd:${operation}_Request>` +
    `</env:Body>` +
    `</env:Envelope>`
  )
}

interface XmlNode {
  name: string
  localName: string
  attributes: Record<string, string>
  children: XmlNode[]
  text: string
}

/**
 * Minimal XML parser tuned for Workday SOAP responses: namespaced tags,
 * attributes, mixed text, self-closing tags, and CDATA sections.
 * Not a general-purpose parser — it does not expand entities beyond the
 * standard five and ignores processing instructions and DOCTYPE.
 */
function parseXml(xml: string): XmlNode {
  let i = 0
  const len = xml.length

  function skipWhitespace() {
    while (i < len && xml.charCodeAt(i) <= 32) i++
  }

  function readName(): string {
    const start = i
    while (i < len) {
      const c = xml[i]
      if (
        c === ' ' ||
        c === '\t' ||
        c === '\n' ||
        c === '\r' ||
        c === '>' ||
        c === '/' ||
        c === '='
      )
        break
      i++
    }
    return xml.slice(start, i)
  }

  function readAttributes(): Record<string, string> {
    const attrs: Record<string, string> = {}
    while (i < len) {
      skipWhitespace()
      const c = xml[i]
      if (c === '>' || c === '/' || c === '?') return attrs
      const name = readName()
      skipWhitespace()
      if (xml[i] !== '=') {
        attrs[name] = ''
        continue
      }
      i++ // =
      skipWhitespace()
      const quote = xml[i]
      if (quote !== '"' && quote !== "'") {
        attrs[name] = ''
        continue
      }
      i++
      const start = i
      while (i < len && xml[i] !== quote) i++
      attrs[name] = decodeEntities(xml.slice(start, i))
      if (i < len) i++ // closing quote
    }
    return attrs
  }

  function decodeEntities(s: string): string {
    return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, ent) => {
      switch (ent) {
        case 'amp':
          return '&'
        case 'lt':
          return '<'
        case 'gt':
          return '>'
        case 'quot':
          return '"'
        case 'apos':
          return "'"
        default:
          if (ent.startsWith('#x')) return String.fromCodePoint(Number.parseInt(ent.slice(2), 16))
          if (ent.startsWith('#')) return String.fromCodePoint(Number.parseInt(ent.slice(1), 10))
          return `&${ent};`
      }
    })
  }

  function localOf(name: string): string {
    const idx = name.indexOf(':')
    return idx === -1 ? name : name.slice(idx + 1)
  }

  function parseNode(): XmlNode {
    if (xml[i] !== '<') throw new Error(`Expected '<' at ${i}`)
    i++
    const name = readName()
    const attrs = readAttributes()
    skipWhitespace()
    const node: XmlNode = {
      name,
      localName: localOf(name),
      attributes: attrs,
      children: [],
      text: '',
    }
    if (xml[i] === '/') {
      i += 2 // />
      return node
    }
    if (xml[i] !== '>') throw new Error(`Expected '>' at ${i}`)
    i++

    while (i < len) {
      if (xml[i] === '<') {
        if (xml.startsWith('<!--', i)) {
          const end = xml.indexOf('-->', i)
          i = end === -1 ? len : end + 3
          continue
        }
        if (xml.startsWith('<![CDATA[', i)) {
          const end = xml.indexOf(']]>', i + 9)
          const data = xml.slice(i + 9, end === -1 ? len : end)
          node.text += data
          i = end === -1 ? len : end + 3
          continue
        }
        if (xml[i + 1] === '/') {
          i += 2
          while (i < len && xml[i] !== '>') i++
          if (i < len) i++
          return node
        }
        node.children.push(parseNode())
      } else {
        const start = i
        while (i < len && xml[i] !== '<') i++
        node.text += decodeEntities(xml.slice(start, i))
      }
    }
    return node
  }

  // Skip XML declaration and DOCTYPE
  while (i < len) {
    skipWhitespace()
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i)
      i = end === -1 ? len : end + 2
      continue
    }
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i)
      i = end === -1 ? len : end + 3
      continue
    }
    if (xml.startsWith('<!', i)) {
      const end = xml.indexOf('>', i)
      i = end === -1 ? len : end + 1
      continue
    }
    if (xml[i] === '<') break
    i++
  }
  return parseNode()
}

/**
 * Converts a parsed XML node tree into the JS object shape that the previous
 * `soap` library produced: nested objects keyed by local element name,
 * attributes under `attributes`, repeated elements collapsed into arrays,
 * and pure text nodes returned as strings.
 */
function nodeToValue(node: XmlNode): unknown {
  const hasChildren = node.children.length > 0
  const trimmedText = node.text.trim()
  const attrKeys = Object.keys(node.attributes).filter(
    (k) => k !== 'xmlns' && !k.startsWith('xmlns:')
  )

  if (!hasChildren && attrKeys.length === 0) {
    return trimmedText
  }

  const obj: Record<string, unknown> = {}
  if (attrKeys.length > 0) {
    const attrs: Record<string, string> = {}
    for (const k of attrKeys) {
      const localKey = k.includes(':') ? k.slice(k.indexOf(':') + 1) : k
      attrs[localKey] = node.attributes[k]
    }
    obj.attributes = attrs
  }

  if (!hasChildren && trimmedText !== '') {
    obj.$value = trimmedText
    return obj
  }

  for (const child of node.children) {
    const key = child.localName
    const value = nodeToValue(child)
    if (key in obj) {
      const existing = obj[key]
      if (Array.isArray(existing)) {
        existing.push(value)
      } else {
        obj[key] = [existing, value]
      }
    } else {
      obj[key] = value
    }
  }
  return obj
}

function findFirst(node: XmlNode, localName: string): XmlNode | null {
  if (node.localName === localName) return node
  for (const child of node.children) {
    const found = findFirst(child, localName)
    if (found) return found
  }
  return null
}

function extractFaultMessage(envelope: XmlNode): string | null {
  const fault = findFirst(envelope, 'Fault')
  if (!fault) return null
  const faultstring = findFirst(fault, 'faultstring')
  if (faultstring?.text.trim()) return faultstring.text.trim()
  const reason = findFirst(fault, 'Reason')
  if (reason) {
    const text = findFirst(reason, 'Text')
    if (text?.text.trim()) return text.text.trim()
  }
  const detail = findFirst(fault, 'detail') ?? findFirst(fault, 'Detail')
  if (detail) {
    const msg = findFirst(detail, 'Validation_Error') ?? findFirst(detail, 'Detail_Message')
    if (msg?.text.trim()) return msg.text.trim()
  }
  return 'SOAP fault returned by Workday'
}

async function callOperation(
  operation: WorkdayOperation,
  args: Record<string, unknown>,
  endpoint: string,
  username: string,
  password: string
): Promise<[WorkdaySoapResult, string, Record<string, unknown>, string]> {
  const envelope = buildEnvelope(operation, args, username, password)

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `""`,
    },
    body: envelope,
  })

  const responseText = await response.text()

  let root: XmlNode
  try {
    root = parseXml(responseText)
  } catch (err) {
    logger.error('Failed to parse Workday SOAP response', {
      operation,
      status: response.status,
      error: getErrorMessage(err),
    })
    throw new Error(
      `Workday returned an unparseable response (HTTP ${response.status}): ${responseText.slice(0, 500)}`
    )
  }

  const fault = extractFaultMessage(root)
  if (fault) {
    throw new Error(fault)
  }

  if (!response.ok) {
    throw new Error(`Workday SOAP request failed (HTTP ${response.status})`)
  }

  const responseElement = findFirst(root, `${operation}_Response`)
  const value = (responseElement ? nodeToValue(responseElement) : {}) as WorkdaySoapResult

  return [value, responseText, {}, envelope]
}

/**
 * Creates a typed SOAP client for a Workday service. The returned object
 * exposes the same `<Operation>Async` methods the previous `soap`-library
 * client did, so existing call sites do not change. Internally this issues
 * SOAP-over-HTTP requests directly with hand-built envelopes and an XML
 * response parser — no WSDL fetch.
 */
export async function createWorkdaySoapClient(
  tenantUrl: string,
  tenant: string,
  service: WorkdayServiceKey,
  username: string,
  password: string
): Promise<WorkdayClient> {
  const endpoint = buildServiceUrl(tenantUrl, tenant, service)
  logger.info('Creating Workday SOAP client', { service, endpoint })

  function bind(operation: WorkdayOperation): SoapOperationFn {
    return (args) => callOperation(operation, args, endpoint, username, password)
  }

  return {
    Get_WorkersAsync: bind('Get_Workers'),
    Get_OrganizationsAsync: bind('Get_Organizations'),
    Put_ApplicantAsync: bind('Put_Applicant'),
    Hire_EmployeeAsync: bind('Hire_Employee'),
    Change_JobAsync: bind('Change_Job'),
    Terminate_EmployeeAsync: bind('Terminate_Employee'),
    Change_Personal_InformationAsync: bind('Change_Personal_Information'),
    Put_Onboarding_Plan_AssignmentAsync: bind('Put_Onboarding_Plan_Assignment'),
  }
}

/**
 * Builds a Workday object reference in the format the SOAP API expects.
 * Generates: { ID: { attributes: { 'wd:type': idType }, $value: idValue } }
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
