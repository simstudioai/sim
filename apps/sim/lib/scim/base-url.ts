import { getBaseUrl } from '@/lib/core/utils/urls'
import { SCIM_BASE_PATH } from '@/lib/scim/protocol/constants'

/** The absolute root of the SCIM surface, e.g. `https://sim.ai/api/scim/v2`; used for `meta.location`, `$ref`, and settings. */
export function scimBaseUrl(): string {
  return `${getBaseUrl()}${SCIM_BASE_PATH}`
}
