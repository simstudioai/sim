import { createLogger } from '@sim/logger'

export const FORMS_API_BASE = 'https://forms.googleapis.com/v1'

const logger = createLogger('GoogleFormsUtils')

export function buildListResponsesUrl(params: { formId: string; pageSize?: number }): string {
  const { formId, pageSize } = params
  const url = new URL(`${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/responses`)
  if (pageSize && pageSize > 0) {
    const limited = Math.min(pageSize, 5000)
    url.searchParams.set('pageSize', String(limited))
  }
  const finalUrl = url.toString()
  logger.debug('Built Google Forms list responses URL', { finalUrl })
  return finalUrl
}

export function buildGetResponseUrl(params: { formId: string; responseId: string }): string {
  const { formId, responseId } = params
  const finalUrl = `${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(responseId)}`
  logger.debug('Built Google Forms get response URL', { finalUrl })
  return finalUrl
}

export function buildGetFormUrl(formId: string): string {
  const finalUrl = `${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}`
  logger.debug('Built Google Forms get form URL', { finalUrl })
  return finalUrl
}

export function buildCreateFormUrl(unpublished?: boolean): string {
  const url = new URL(`${FORMS_API_BASE}/forms`)
  if (unpublished) {
    url.searchParams.set('unpublished', 'true')
  }
  const finalUrl = url.toString()
  logger.debug('Built Google Forms create form URL', { finalUrl })
  return finalUrl
}

export function buildBatchUpdateUrl(formId: string): string {
  const finalUrl = `${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}:batchUpdate`
  logger.debug('Built Google Forms batch update URL', { finalUrl })
  return finalUrl
}

export function buildSetPublishSettingsUrl(formId: string): string {
  const finalUrl = `${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}:setPublishSettings`
  logger.debug('Built Google Forms set publish settings URL', { finalUrl })
  return finalUrl
}

export function buildListWatchesUrl(formId: string): string {
  const finalUrl = `${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/watches`
  logger.debug('Built Google Forms list watches URL', { finalUrl })
  return finalUrl
}

export function buildCreateWatchUrl(formId: string): string {
  const finalUrl = `${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/watches`
  logger.debug('Built Google Forms create watch URL', { finalUrl })
  return finalUrl
}

export function buildDeleteWatchUrl(formId: string, watchId: string): string {
  const finalUrl = `${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/watches/${encodeURIComponent(watchId)}`
  logger.debug('Built Google Forms delete watch URL', { finalUrl })
  return finalUrl
}

export function buildRenewWatchUrl(formId: string, watchId: string): string {
  const finalUrl = `${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/watches/${encodeURIComponent(watchId)}:renew`
  logger.debug('Built Google Forms renew watch URL', { finalUrl })
  return finalUrl
}
