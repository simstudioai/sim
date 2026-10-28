import type { MailgunRegion } from '@/tools/mailgun/types'

/**
 * Mailgun hosts each account in one region, and a domain created in the EU region
 * is only reachable through the EU host (the US host answers 401). Anything other
 * than `eu` resolves to the US host so workflows saved before the region existed
 * keep their behavior.
 * See https://documentation.mailgun.com/docs/mailgun/api-reference/api-overview
 */
export function getMailgunApiBaseUrl(region?: MailgunRegion): string {
  return region === 'eu' ? 'https://api.eu.mailgun.net/v3' : 'https://api.mailgun.net/v3'
}
