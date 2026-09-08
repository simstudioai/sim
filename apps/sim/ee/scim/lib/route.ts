import { createScimRouteBuilder } from '@/lib/api/server/routes'
import { authenticateScimRequest } from '@/ee/scim/lib/authenticate'
import { recordScimRequest } from '@/ee/scim/lib/request-log'

/**
 * The route builder wired to this deployment.
 *
 * The builder takes its authenticator and request recorder as dependencies so
 * it stays testable without a database; this module is where the real ones are
 * bound, and it is what every route file imports.
 */
export const defineScimRoute = createScimRouteBuilder({
  authenticate: authenticateScimRequest,
  recordRequest: recordScimRequest,
})
