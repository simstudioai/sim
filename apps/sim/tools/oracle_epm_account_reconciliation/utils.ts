import type { ToolConfig } from '@/tools/types'

/** The reusable service account owns authorization and destination; neither is model-visible. */
export const arcsAuthParamFields = {
  oauthCredential: {
    type: 'string',
    description: 'Oracle EPM service-account credential',
    required: true,
    visibility: 'user-only',
  },
  accessToken: {
    type: 'string',
    description: 'Authorization material injected from the selected credential',
    required: false,
    visibility: 'hidden',
  },
  instanceUrl: {
    type: 'string',
    description: 'Environment URL injected from the selected credential',
    required: false,
    visibility: 'hidden',
  },
} satisfies ToolConfig['params']

export function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error('Boolean inputs must be true or false')
}

export function optionalString(value: unknown): unknown {
  return value === '' || value === null ? undefined : value
}

export function parseJson(value: unknown, label: string): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}
