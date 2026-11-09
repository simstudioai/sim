import { parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const benchmarkParams = {
  creating: parseAsBoolean.withDefault(false),
  benchmarkId: parseAsString.withDefault(''),
  benchmarkView: parseAsStringLiteral(['current', 'history'] as const).withDefault('current'),
  runId: parseAsString.withDefault(''),
  compareRunId: parseAsString.withDefault(''),
  runsCursor: parseAsString.withDefault(''),
}

export const benchmarkUrlOptions = {
  history: 'push',
  clearOnDefault: true,
  urlKeys: {
    benchmarkId: 'benchmark',
    creating: 'new',
    benchmarkView: 'view',
    runId: 'run',
    compareRunId: 'compare',
    runsCursor: 'cursor',
  },
} as const

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
