import { parseAsArrayOf, parseAsInteger, parseAsString } from 'nuqs/server'
import { DEFAULT_TOOL_MODEL_IDS } from '@/app/(landing)/models/tools'

/**
 * Shareable calculator inputs. Every value is small and discrete, so a pasted
 * link reproduces the exact estimate; number fields debounce their URL writes.
 *
 * - `models`: selected catalog model ids.
 * - `input` / `output`: tokens per request.
 * - `cached`: percent of input tokens served from the prompt cache (0-100).
 * - `requests`: requests per day.
 */
export const pricingCalculatorParsers = {
  models: parseAsArrayOf(parseAsString).withDefault(DEFAULT_TOOL_MODEL_IDS),
  input: parseAsInteger.withDefault(2_000),
  output: parseAsInteger.withDefault(500),
  cached: parseAsInteger.withDefault(0),
  requests: parseAsInteger.withDefault(1_000),
}

export const pricingCalculatorUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
