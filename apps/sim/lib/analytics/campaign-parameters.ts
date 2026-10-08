/**
 * Campaign query parameters shared by the Google tag's sanitized page location
 * and Sim's own attribution cookies, so a new parameter reaches both.
 */

export const UTM_PARAMETERS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_id',
  'utm_term',
  'utm_content',
] as const

export const GOOGLE_CLICK_ID_PARAMETERS = ['gclid', 'dclid', 'gbraid', 'wbraid'] as const
