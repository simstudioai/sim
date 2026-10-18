import { parseAsArrayOf, parseAsString } from 'nuqs/server'
import { DEFAULT_TOOL_MODEL_IDS } from '@/app/(landing)/models/tools'

/**
 * Only the model selection is shareable. The pasted text never enters the URL:
 * it can be large, and it stays in the visitor's browser.
 */
export const tokenCounterParsers = {
  models: parseAsArrayOf(parseAsString).withDefault(DEFAULT_TOOL_MODEL_IDS),
}

export const tokenCounterUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
