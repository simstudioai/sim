import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import {
  createInternalSessionOrExecutorAuth,
  type InternalAuthPolicy,
  InternalUnauthenticatedError,
} from '@/lib/api/server/routes'

export const WINDCHILL_DELEGATION_AUDIENCE = 'sim:windchill'

const sessionOrExecutorAuth = createInternalSessionOrExecutorAuth({
  audience: WINDCHILL_DELEGATION_AUDIENCE,
})

/** Windchill's internal tool route is callable only from a bound workflow executor. */
export const internalWindchillExecutorAuth: InternalAuthPolicy<WorkflowExecutionDelegatedPrincipal> =
  {
    async authenticate(request, params) {
      const principal = await sessionOrExecutorAuth.authenticate(request, params)
      if (
        principal.kind !== 'delegated' ||
        principal.serviceId !== 'executor' ||
        !('delegationContext' in principal)
      ) {
        throw new InternalUnauthenticatedError('Authentication required')
      }
      return principal
    },
  }
