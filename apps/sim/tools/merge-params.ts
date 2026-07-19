import { isRecordLike } from '@sim/utils/object'
import { isEmptyTagValue } from '@/tools/shared/tags'

/**
 * Pure parameter-merging helpers, split out of `@/tools/params` so that
 * consumers needing only the merge logic do not pull in `@/tools/utils` —
 * and through it the full `@/tools/registry` module graph (~247 tools).
 */

/**
 * Checks if a value is non-empty (not undefined, null, or empty string)
 */
export function isNonEmpty(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

/**
 * Deep merges inputMapping objects, where LLM values fill in empty/missing user values.
 * User-provided non-empty values take precedence.
 */
export function deepMergeInputMapping(
  llmInputMapping: Record<string, unknown> | undefined,
  userInputMapping: Record<string, unknown> | string | undefined
): Record<string, unknown> {
  // Parse user inputMapping if it's a JSON string
  let parsedUserMapping: Record<string, unknown> = {}
  if (typeof userInputMapping === 'string') {
    try {
      const parsed = JSON.parse(userInputMapping)
      if (isRecordLike(parsed)) {
        parsedUserMapping = parsed
      }
    } catch {
      // Invalid JSON, treat as empty
    }
  } else if (
    typeof userInputMapping === 'object' &&
    userInputMapping !== null &&
    !Array.isArray(userInputMapping)
  ) {
    parsedUserMapping = userInputMapping
  }

  // If no LLM mapping, return user mapping (or empty)
  if (!llmInputMapping || typeof llmInputMapping !== 'object') {
    return parsedUserMapping
  }

  // Deep merge: LLM values as base, user non-empty values override
  // If user provides empty object {}, LLM values fill all fields (intentional)
  const merged: Record<string, unknown> = { ...llmInputMapping }

  for (const [key, userValue] of Object.entries(parsedUserMapping)) {
    // Only override LLM value if user provided a non-empty value
    if (isNonEmpty(userValue)) {
      merged[key] = userValue
    }
  }

  return merged
}

/**
 * Merges user-provided parameters with LLM-generated parameters.
 * User-provided parameters take precedence, but empty strings are skipped
 * so that LLM-generated values are used when user clears a field.
 *
 * Special handling for inputMapping: deep merges so LLM can fill in
 * fields that user left empty in the UI.
 */
export function mergeToolParameters(
  userProvidedParams: Record<string, unknown>,
  llmGeneratedParams: Record<string, unknown>
): Record<string, unknown> {
  // Filter out empty and effectively-empty values from user-provided params
  // so that cleared fields don't override LLM values
  const filteredUserParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(userProvidedParams)) {
    if (isNonEmpty(value)) {
      // Skip tag-based params if they're effectively empty (only default/unfilled entries)
      if ((key === 'documentTags' || key === 'tagFilters') && isEmptyTagValue(value)) {
        continue
      }
      filteredUserParams[key] = value
    }
  }

  // Start with LLM params as base
  const result: Record<string, unknown> = { ...llmGeneratedParams }

  // Apply user params, with special handling for inputMapping
  for (const [key, userValue] of Object.entries(filteredUserParams)) {
    if (key === 'inputMapping') {
      // Deep merge inputMapping so LLM values fill in empty user fields
      const llmInputMapping = llmGeneratedParams.inputMapping as Record<string, unknown> | undefined
      const mergedInputMapping = deepMergeInputMapping(
        llmInputMapping,
        userValue as Record<string, unknown> | string | undefined
      )
      result.inputMapping = mergedInputMapping
    } else {
      // Normal override for other params
      result[key] = userValue
    }
  }

  // If LLM provided inputMapping but user didn't, ensure it's included
  if (llmGeneratedParams.inputMapping && !filteredUserParams.inputMapping) {
    result.inputMapping = llmGeneratedParams.inputMapping
  }

  return result
}
