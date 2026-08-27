import { isRecordLike } from '@sim/utils/object'
import { isEmptyTagValue } from '@/tools/shared/tags'

/**
 * Merging of user-provided and LLM-generated tool parameters.
 *
 * Deliberately kept in its own leaf module rather than in `@/tools/params`.
 * `params.ts` imports `getTool` from `@/tools/utils`, which statically imports
 * the 4,300-entry `@/tools/registry` barrel — so importing anything from
 * `params.ts` drags the whole tool registry into the caller's module graph
 * (4,926 modules, versus 17 without that edge).
 *
 * `providers/utils.ts` needs only `mergeToolParameters`, and this function needs
 * no tool lookup at all, so it lives here and that import edge stays cheap.
 * Nothing in this file may import `@/tools/utils`, `@/tools/registry`, or
 * `@/tools/params`.
 */

/** Checks if a value is non-empty (not undefined, null, or empty string). */
export function isNonEmpty(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

/**
 * Deep merges inputMapping objects, where LLM values fill in empty/missing user values.
 * User-provided non-empty values take precedence.
 *
 * Module-private: only {@link mergeToolParameters} needs it. It was exported from
 * `@/tools/params` but never imported anywhere.
 */
function deepMergeInputMapping(
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
  } else if (isRecordLike(userInputMapping)) {
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
