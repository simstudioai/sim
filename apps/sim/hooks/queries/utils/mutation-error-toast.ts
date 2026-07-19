import { toast } from '@sim/emcn'
import { extractValidationIssues, isValidationError } from '@/lib/api/client/errors'

const ERROR_TOAST_DURATION_MS = 5000

/**
 * Toasts a mutation failure for surfaces with no inline validation UI: the
 * first validation issue's message when the error is a validation failure,
 * otherwise the error's own message.
 */
export function toastMutationError(error: Error): void {
  toast.error(extractValidationIssues(error)[0]?.message ?? error.message, {
    duration: ERROR_TOAST_DURATION_MS,
  })
}

/**
 * Toasts a mutation failure unless it is a validation error — for mutations
 * whose validation failures are surfaced inline by the calling UI.
 */
export function toastNonValidationError(error: Error): void {
  if (isValidationError(error)) return
  toast.error(error.message, { duration: ERROR_TOAST_DURATION_MS })
}
