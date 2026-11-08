import { parseAsStringLiteral } from 'nuqs/server'

/** Null means there is no OAuth completion notice to show. */
export const slackSetupResultParam = {
  key: 'slackSetup',
  parser: parseAsStringLiteral(['complete']).withOptions({ history: 'replace' }),
} as const
