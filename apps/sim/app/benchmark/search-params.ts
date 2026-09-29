import { parseAsString } from 'nuqs/server'
import {
  benchmarkParams,
  benchmarkUrlOptions,
} from '@/app/o/[organizationId]/benchmark/search-params'

export const benchmarkConsoleParams = {
  ...benchmarkParams,
  organizationId: parseAsString.withDefault(''),
  runAsUserId: parseAsString.withDefault(''),
}
export const benchmarkConsoleUrlOptions = {
  ...benchmarkUrlOptions,
  urlKeys: { ...benchmarkUrlOptions.urlKeys, organizationId: 'organization', runAsUserId: 'user' },
}

export const emptyBenchmarkSelection = {
  creating: null,
  benchmarkId: null,
  benchmarkView: null,
  runId: null,
  compareRunId: null,
  runsCursor: null,
} as const
