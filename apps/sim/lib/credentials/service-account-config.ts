import type { z } from 'zod'

const MAX_CONFIG_BYTES = 64 * 1024

/**
 * Parses a service-account configuration submitted as JSON (the connect modal's
 * `serviceAccountJson`) against its provider schema. Returns the first
 * user-facing problem instead of throwing, so each provider raises it in its
 * own error type.
 */
export function parseServiceAccountConfig<T extends z.ZodType>(
  serialized: string,
  schema: T,
  label: string
): { success: true; data: z.infer<T> } | { success: false; message: string } {
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONFIG_BYTES) {
    return { success: false, message: `${label} configuration is too large` }
  }
  let raw: unknown
  try {
    raw = JSON.parse(serialized)
  } catch {
    return { success: false, message: `Invalid ${label} configuration` }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? `Invalid ${label} configuration`,
    }
  }
  return { success: true, data: parsed.data }
}
