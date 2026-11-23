/**
 * A model ID typed into a media generator instead of picked from its catalog. It is sent to the
 * provider as is, so it must stay a plain model name or endpoint path: it lands in request URLs.
 */
const CUSTOM_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/
const MAX_CUSTOM_MODEL_ID_LENGTH = 200

/** Returns the trimmed custom model ID, or throws when it is not a safe model name or path. */
export function parseCustomModelId(id: string, providerLabel: string): string {
  const trimmed = id.trim()
  if (
    trimmed.length > MAX_CUSTOM_MODEL_ID_LENGTH ||
    !CUSTOM_MODEL_ID_PATTERN.test(trimmed) ||
    trimmed.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new Error(
      `Invalid ${providerLabel} model: ${id}. Use the provider's model ID or endpoint path`
    )
  }
  return trimmed
}

/** Settings are only validated for catalog models, so a custom model sends the prompt alone. */
export function assertNoCustomModelSettings(
  modelId: string,
  settings: Record<string, unknown>
): void {
  const supplied = Object.entries(settings)
    .filter(([, value]) => value !== undefined && value !== '' && value !== 'default')
    .map(([key]) => key)
  if (supplied.length > 0) {
    throw new Error(
      `${modelId} is not a listed model, so only the prompt is sent. Remove ${supplied.join(', ')} or pick a listed model`
    )
  }
}
