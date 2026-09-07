import { createScimRouteBuilder } from '@/lib/api/server/routes/scim-route'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { authenticateScimRequest } from '@/lib/scim/authenticate'
import { SCIM_BASE_PATH } from '@/lib/scim/protocol/constants'
import { recordScimRequest } from '@/lib/scim/request-log'

/**
 * The route builder wired to this deployment.
 *
 * The builder takes its authenticator, base URL, and request recorder as
 * dependencies so it stays testable without a database; this module is where
 * the real ones are bound, and it is what every route file imports.
 */
export const defineScimRoute = createScimRouteBuilder({
  authenticate: authenticateScimRequest,
  baseUrl: () => `${getBaseUrl()}${SCIM_BASE_PATH}`,
  recordRequest: recordScimRequest,
})
