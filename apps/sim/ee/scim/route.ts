import { createScimRouteBuilder } from '@/lib/api/server/routes'
import { authenticateScimRequest } from '@/ee/scim/authenticate'
import { scimBaseUrl } from '@/ee/scim/base-url'
import { recordScimRequest } from '@/ee/scim/request-log'

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
