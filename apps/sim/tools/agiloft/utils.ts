import type {
  AgiloftAttachmentInfoParams,
  AgiloftBaseParams,
  AgiloftDeleteRecordParams,
  AgiloftGetChoiceLineIdParams,
  AgiloftLockRecordParams,
  AgiloftReadRecordParams,
  AgiloftRemoveAttachmentParams,
  AgiloftRetrieveAttachmentParams,
  AgiloftRunActionButtonParams,
  AgiloftSearchRecordsParams,
  AgiloftSelectRecordsParams,
} from '@/tools/agiloft/types'
import type { HttpMethod } from '@/tools/types'

/** URL builders (credential-free -- auth is via Bearer token header) */

function encodeTable(params: AgiloftBaseParams) {
  return {
    kb: encodeURIComponent(params.knowledgeBase),
    table: encodeURIComponent(params.table),
  }
}

function buildEwBaseQuery(params: AgiloftBaseParams): string {
  const { kb, table } = encodeTable(params)
  return `$KB=${kb}&$table=${table}&$lang=en`
}

/**
 * Serializes a record's field values as the `&field=value` pairs EWCreate and
 * EWUpdate expect. Agiloft reads record data straight off the query string;
 * there is no JSON body form of these operations.
 */
function encodeRecordData(data: Record<string, unknown>): string {
  let encoded = ''
  for (const [field, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue
    encoded += `&${encodeURIComponent(field)}=${encodeURIComponent(String(value))}`
  }
  return encoded
}

export function buildCreateRecordUrl(
  base: string,
  params: AgiloftBaseParams,
  data: Record<string, unknown>
): string {
  return `${base}/ewws/EWCreate?${buildEwBaseQuery(params)}${encodeRecordData(data)}`
}

export function buildReadRecordUrl(base: string, params: AgiloftReadRecordParams): string {
  const id = encodeURIComponent(params.recordId.trim())
  return `${base}/ewws/EWRead?${buildEwBaseQuery(params)}&id=${id}`
}

export function buildUpdateRecordUrl(
  base: string,
  params: AgiloftBaseParams & { recordId: string },
  data: Record<string, unknown>
): string {
  const id = encodeURIComponent(params.recordId.trim())
  return `${base}/ewws/EWUpdate?${buildEwBaseQuery(params)}&id=${id}${encodeRecordData(data)}`
}

/**
 * EWDelete requires a delete rule naming the strategy for dependent records;
 * omitting it is a malformed request.
 */
export function buildDeleteRecordUrl(base: string, params: AgiloftDeleteRecordParams): string {
  const id = encodeURIComponent(params.recordId.trim())
  const deleteRule = encodeURIComponent(params.deleteRule ?? 'ERROR_IF_DEPENDANTS')
  return `${base}/ewws/EWDelete?${buildEwBaseQuery(params)}&id=${id}&deleteRule=${deleteRule}`
}

export function buildSearchRecordsUrl(base: string, params: AgiloftSearchRecordsParams): string {
  let url = `${base}/ewws/EWSearch?${buildEwBaseQuery(params)}`

  if (params.search) {
    url += `&search=${encodeURIComponent(params.search.trim())}`
  }
  if (params.query) {
    url += `&query=${encodeURIComponent(params.query)}`
  }

  if (params.fields) {
    const fieldList = params.fields
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
    for (const field of fieldList) {
      url += `&field=${encodeURIComponent(field)}`
    }
  }

  if (params.page) {
    url += `&page=${encodeURIComponent(params.page)}`
  }
  if (params.limit) {
    url += `&limit=${encodeURIComponent(params.limit)}`
  }

  return url
}

export function buildSelectRecordsUrl(base: string, params: AgiloftSelectRecordsParams): string {
  const where = encodeURIComponent(params.where)
  return `${base}/ewws/EWSelect?${buildEwBaseQuery(params)}&where=${where}`
}

export function buildRetrieveAttachmentUrl(
  base: string,
  params: AgiloftRetrieveAttachmentParams
): string {
  const id = encodeURIComponent(params.recordId.trim())
  const field = encodeURIComponent(params.fieldName.trim())
  const position = encodeURIComponent(params.position)
  return `${base}/ewws/EWRetrieve?${buildEwBaseQuery(params)}&id=${id}&field=${field}&filePosition=${position}`
}

export function buildRemoveAttachmentUrl(
  base: string,
  params: AgiloftRemoveAttachmentParams
): string {
  const id = encodeURIComponent(params.recordId.trim())
  const field = encodeURIComponent(params.fieldName.trim())
  const position = encodeURIComponent(params.position)
  return `${base}/ewws/EWRemoveAttachment?${buildEwBaseQuery(params)}&id=${id}&field=${field}&filePosition=${position}`
}

export function buildAttachmentInfoUrl(base: string, params: AgiloftAttachmentInfoParams): string {
  const id = encodeURIComponent(params.recordId.trim())
  const fieldName = encodeURIComponent(params.fieldName.trim())
  return `${base}/ewws/EWAttachInfo/.json?${buildEwBaseQuery(params)}&id=${id}&field=${fieldName}`
}

/**
 * `force` is only meaningful on the DELETE (unlock) variant, where it lets an
 * admin release a lock held by another user.
 */
export function buildLockRecordUrl(base: string, params: AgiloftLockRecordParams): string {
  const id = encodeURIComponent(params.recordId.trim())
  let url = `${base}/ewws/EWLock?${buildEwBaseQuery(params)}&id=${id}`
  if (params.lockAction === 'unlock' && params.force) {
    url += '&force=true'
  }
  return url
}

export function buildAttachFileUrl(
  base: string,
  params: AgiloftBaseParams & { recordId: string; fieldName: string },
  fileName: string
): string {
  const { kb, table } = encodeTable(params)
  const recordId = encodeURIComponent(params.recordId.trim())
  const fieldName = encodeURIComponent(params.fieldName.trim())
  const encodedFileName = encodeURIComponent(fileName)
  return `${base}/ewws/EWAttach?$KB=${kb}&$table=${table}&$lang=en&id=${recordId}&field=${fieldName}&fileName=${encodedFileName}`
}

export function buildGetChoiceLineIdUrl(
  base: string,
  params: AgiloftGetChoiceLineIdParams
): string {
  const field = encodeURIComponent(params.fieldName.trim())
  const value = encodeURIComponent(params.value.trim())
  return `${base}/ewws/EWGetChoiceLineId?${buildEwBaseQuery(params)}&field=${field}&value=${value}`
}

export function getLockHttpMethod(lockAction: string): HttpMethod {
  switch (lockAction) {
    case 'lock':
      return 'PUT'
    case 'unlock':
      return 'DELETE'
    default:
      return 'GET'
  }
}

/**
 * EWActionButton runs asynchronously and therefore lives under the `/ewws/async`
 * prefix rather than `/ewws` directly.
 */
export function buildRunActionButtonUrl(
  base: string,
  params: AgiloftRunActionButtonParams
): string {
  const id = encodeURIComponent(params.recordId.trim())
  const name = encodeURIComponent(params.actionButtonField.trim())
  return `${base}/ewws/async/EWActionButton?${buildEwBaseQuery(params)}&name=${name}&id=${id}`
}
