import { parseAsString } from 'nuqs/server'

export const benchmarkParams = {
  benchmarkId: parseAsString.withDefault(''),
}

export const benchmarkUrlOptions = {
  history: 'push',
  clearOnDefault: true,
  urlKeys: { benchmarkId: 'benchmark' },
} as const
