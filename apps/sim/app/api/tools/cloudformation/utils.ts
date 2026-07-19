import type { Capability, Parameter, Tag } from '@aws-sdk/client-cloudformation'

/**
 * Parses a comma-separated capabilities string (e.g. "CAPABILITY_IAM,CAPABILITY_NAMED_IAM")
 * into the array shape the CloudFormation SDK expects.
 */
export function parseCapabilities(value?: string): Capability[] | undefined {
  if (!value) return undefined
  const capabilities = value
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
  return capabilities.length > 0 ? (capabilities as Capability[]) : undefined
}

/**
 * Maps camelCase stack parameter inputs to the PascalCase `Parameter` shape CloudFormation expects.
 */
export function toStackParameters(
  parameters?: { parameterKey: string; parameterValue?: string; usePreviousValue?: boolean }[]
): Parameter[] | undefined {
  if (!parameters || parameters.length === 0) return undefined
  return parameters.map((p) => ({
    ParameterKey: p.parameterKey,
    ParameterValue: p.parameterValue,
    UsePreviousValue: p.usePreviousValue,
  }))
}

/**
 * Maps camelCase tag inputs to the PascalCase `Tag` shape CloudFormation expects.
 */
export function toStackTags(tags?: { key: string; value: string }[]): Tag[] | undefined {
  if (!tags || tags.length === 0) return undefined
  return tags.map((t) => ({ Key: t.key, Value: t.value }))
}
