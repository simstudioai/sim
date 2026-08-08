import type { V2ErrorPolicy } from '@/lib/api/server/routes'
import { ChatRunProgressUnavailableError } from '@/lib/copilot/chat/application/errors'
import {
  InsufficientWorkspacePermissionsError,
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
} from '@/lib/core/application'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

const defaultPolicy = {
  render(error) {
    if (error instanceof PrincipalKindAuthorizationError) {
      return v2Error('FORBIDDEN', 'Chat runs require a personal API key')
    }
    if (error instanceof ChatRunProgressUnavailableError) {
      return v2Error('SERVICE_UNAVAILABLE', error.message)
    }
    return v2CaughtOrchestrationError(error)
  },
} satisfies V2ErrorPolicy

export const v2ChatRunErrorPolicies = {
  default: defaultPolicy,
  detail: {
    render(error) {
      if (
        error instanceof PrincipalKindAuthorizationError ||
        error instanceof PersonalApiKeysDisabledError ||
        error instanceof ChatRunProgressUnavailableError
      ) {
        return defaultPolicy.render(error)
      }
      if (error instanceof InsufficientWorkspacePermissionsError) {
        return v2Error('NOT_FOUND', 'Chat run not found')
      }
      const response = v2CaughtOrchestrationError(error)
      return response?.status === 404 ? v2Error('NOT_FOUND', 'Chat run not found') : response
    },
  } satisfies V2ErrorPolicy,
} as const
