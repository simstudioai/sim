import { isRecordLike } from '@sim/utils/object'

/**
 * Reads the message from a failed Ketch Web API response. Ketch returns errors as
 * `{"error": {"code", "message", "status"}}`; a flat `message` or string `error` is also accepted.
 */
export async function readKetchErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed with status ${response.status}`
  try {
    const data: unknown = await response.json()
    if (!isRecordLike(data)) return fallback
    const { message, error } = data
    if (typeof message === 'string' && message) return message
    if (typeof error === 'string' && error) return error
    if (isRecordLike(error) && typeof error.message === 'string' && error.message) {
      return error.message
    }
  } catch {}
  return fallback
}
