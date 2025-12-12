import { createLogger } from '@/lib/logs/console/logger'

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
