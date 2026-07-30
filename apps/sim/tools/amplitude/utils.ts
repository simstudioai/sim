/**
 * Amplitude hosts differ by data residency region. EU-region projects must send
 * requests to the `eu.amplitude.com` hosts or the API rejects the request.
 * See https://amplitude.com/docs/apis/analytics/http-v2#eu-residency-server-url
 */
export function getIngestionHost(dataResidency?: string): string {
  return dataResidency === 'eu' ? 'https://api.eu.amplitude.com' : 'https://api2.amplitude.com'
}

export function getDashboardHost(dataResidency?: string): string {
  return dataResidency === 'eu' ? 'https://analytics.eu.amplitude.com' : 'https://amplitude.com'
}
