import { createScimRouteBuilder } from '@/lib/api/server/routes/scim-route'
import { authenticateScimRequest } from '@/lib/scim/authenticate'
import { scimBaseUrl } from '@/lib/scim/base-url'
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
  baseUrl: scimBaseUrl,
  recordRequest: recordScimRequest,
})
