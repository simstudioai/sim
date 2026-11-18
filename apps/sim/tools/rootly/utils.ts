import { isRecordLike } from '@sim/utils/object'

/**
 * Builds the message for a failed Rootly response from its JSON:API `errors[0]`. Rootly's
 * `title` is often generic ("Unprocessable Entity") and `detail` is often absent, so both are
 * shown when they differ.
 */
export function rootlyErrorMessage(errorData: unknown, response: Response): string {
  const first =
    isRecordLike(errorData) && Array.isArray(errorData.errors) ? errorData.errors[0] : undefined
  const title = isRecordLike(first) && typeof first.title === 'string' ? first.title : ''
  const detail = isRecordLike(first) && typeof first.detail === 'string' ? first.detail : ''
  if (title && detail && title !== detail) return `${title}: ${detail}`
  return title || detail || `HTTP ${response.status}: ${response.statusText}`
}
