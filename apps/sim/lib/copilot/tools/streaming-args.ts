import { escapeRegExp } from '@sim/utils/string'

/** Extract a completed JSON string field from an argument buffer that may still be partial. */
export function extractStreamingStringArgument(
  input: string | undefined,
  key: string
): string | undefined {
  if (!input) return undefined
  const escapedKey = escapeRegExp(key)
  const match = new RegExp(`"${escapedKey}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(input)
  if (!match?.[1]) return undefined
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    return undefined
  }
}
