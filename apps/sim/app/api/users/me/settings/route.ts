import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { updateUserSettingsContract } from '@/lib/api/contracts'
import {
  defineInternalJsonRoute,
  InternalUnauthenticatedError,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { userAccountOperations } from '@/lib/users/application/operations'
import { updateCurrentUserPreferences } from '@/lib/users/application/preferences'
import { getCurrentUserSettingsUseCase } from '@/lib/users/application/read-current-user'
import { defaultUserSettings } from '@/lib/users/queries'

const logger = createLogger('UserSettingsAPI')

export const GET = withRouteHandler(async () => {
  try {
    const principal = await internalSessionAuth.authenticate()
    const data = await getCurrentUserSettingsUseCase.execute({ principal, input: {} })
    return NextResponse.json({ data }, { status: 200 })
  } catch (error) {
    if (error instanceof InternalUnauthenticatedError) {
      return NextResponse.json({ data: { ...defaultUserSettings, telemetryEnabled: false } })
    }
    logger.error('Settings fetch error', error)
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
  }
})

export const PATCH = defineInternalJsonRoute({
  contract: updateUserSettingsContract,
  auth: internalSessionAuth,
  operation: userAccountOperations.updateSettings,
  rateLimit: internalRateLimits.none({ reason: 'Authenticated current-user preference update' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: updateCurrentUserPreferences,
  present: (result) => result,
})
