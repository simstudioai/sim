import type {
  AgiloftAttachmentInfoParams,
  AgiloftBaseParams,
  AgiloftDeleteRecordParams,
  AgiloftGetChoiceLineIdParams,
  AgiloftLockRecordParams,
  AgiloftReadRecordParams,
  AgiloftRemoveAttachmentParams,
  AgiloftRetrieveAttachmentParams,
  AgiloftSavedSearchParams,
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

export function buildCreateRecordUrl(base: string, params: AgiloftBaseParams): string {
  const { kb, table } = encodeTable(params)
  return `${base}/ewws/REST/${kb}/${table}?$lang=en`
}

export function buildReadRecordUrl(base: string, params: AgiloftReadRecordParams): string {
  const { kb, table } = encodeTable(params)
  const id = encodeURIComponent(params.recordId.trim())
  let url = `${base}/ewws/REST/${kb}/${table}/${id}?$lang=en`

  if (params.fields) {
    const fieldList = params.fields
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
    for (const field of fieldList) {
      url += `&$fields=${encodeURIComponent(field)}`
    }
  }

  return url
}

export function buildUpdateRecordUrl(
  base: string,
  params: AgiloftBaseParams & { recordId: string }
): string {
  const { kb, table } = encodeTable(params)
  const id = encodeURIComponent(params.recordId.trim())
  return `${base}/ewws/REST/${kb}/${table}/${id}?$lang=en`
}

export function buildDeleteRecordUrl(base: string, params: AgiloftDeleteRecordParams): string {
  const { kb, table } = encodeTable(params)
  const id = encodeURIComponent(params.recordId.trim())
  return `${base}/ewws/REST/${kb}/${table}/${id}?$lang=en`
}

function buildEwBaseQuery(params: AgiloftBaseParams): string {
  const { kb, table } = encodeTable(params)
  return `$KB=${kb}&$table=${table}&$lang=en`
}

export function buildSearchRecordsUrl(base: string, params: AgiloftSearchRecordsParams): string {
  const query = encodeURIComponent(params.query)
  let url = `${base}/ewws/EWSearch/.json?${buildEwBaseQuery(params)}&query=${query}`

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
  return `${base}/ewws/EWSelect/.json?${buildEwBaseQuery(params)}&where=${where}`
}

export function buildSavedSearchUrl(base: string, params: AgiloftSavedSearchParams): string {
  return `${base}/ewws/EWSavedSearch/.json?${buildEwBaseQuery(params)}`
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

export function buildLockRecordUrl(base: string, params: AgiloftLockRecordParams): string {
  const id = encodeURIComponent(params.recordId.trim())
  return `${base}/ewws/EWLock/.json?${buildEwBaseQuery(params)}&id=${id}`
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
  return `${base}/ewws/EWGetChoiceLineId/.json?${buildEwBaseQuery(params)}&field=${field}&value=${value}`
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
