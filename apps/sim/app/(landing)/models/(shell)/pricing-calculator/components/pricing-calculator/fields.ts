export const DAYS_PER_MONTH = 30
export const MAX_TOKENS_PER_REQUEST = 100_000_000
export const MAX_REQUESTS_PER_DAY = 1_000_000_000

export type CountParam = 'input' | 'output' | 'cached' | 'requests'

/** The numeric calculator inputs, in render order, shared by the island and its fallback. */
export const COUNT_FIELDS: { key: CountParam; label: string; max: number }[] = [
  { key: 'input', label: 'Input tokens per request', max: MAX_TOKENS_PER_REQUEST },
  { key: 'output', label: 'Output tokens per request', max: MAX_TOKENS_PER_REQUEST },
  { key: 'cached', label: 'Cached input (%)', max: 100 },
  { key: 'requests', label: 'Requests per day', max: MAX_REQUESTS_PER_DAY },
]
