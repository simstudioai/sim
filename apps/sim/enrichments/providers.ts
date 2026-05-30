import type {
  EnrichmentInputField,
  EnrichmentOutputField,
  EnrichmentProvider,
} from '@/enrichments/types'

/**
 * Narrow union of the field types enrichments declare. Assignable to both the
 * tool `OutputType` and the block `ParamType` unions, so a single mapping
 * function feeds both sides without per-call casts.
 */
export type EnrichmentFieldType = 'string' | 'number' | 'boolean' | 'json'

/** Maps an enrichment input/output column type to a block/tool field type. */
export function mapFieldType(
  type: EnrichmentInputField['type'] | EnrichmentOutputField['type']
): EnrichmentFieldType {
  if (type === 'number') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'json') return 'json'
  return 'string'
}

/** Coerces an unknown input value to a trimmed string (`''` when nullish). */
export function str(value: unknown): string {
  return String(value ?? '').trim()
}

/** Strips protocol / path / leading `www.` from a domain-ish input. */
export function normalizeDomain(value: unknown): string {
  return str(value)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

/** Returns the first non-empty string in an array (or `undefined`). */
export function firstNonEmpty(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  for (const item of value) {
    const s = str(item)
    if (s) return s
  }
  return undefined
}

/**
 * Splits a full name into first / last for providers whose API requires both
 * (e.g. Hunter). Returns `null` when the name has fewer than two parts, so the
 * provider falls through to one that accepts a single name string.
 */
export function splitName(fullName: unknown): { firstName: string; lastName: string } | null {
  const parts = str(fullName).split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

/**
 * Declares a tool-backed enrichment provider as plain data. Keeping this free of
 * any `@/tools` reference (the cascade runner does the `executeTool` call) means
 * the enrichment catalog stays client-safe — the table UI imports it only for
 * metadata. Workspace scope and BYOK / hosted-key injection are handled by the
 * runner when it executes `toolId`.
 */
export function toolProvider(provider: EnrichmentProvider): EnrichmentProvider {
  return provider
}
