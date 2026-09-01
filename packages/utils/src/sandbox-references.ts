import { isValidUuid } from '@sim/utils/id'

export const IMMUTABLE_E2B_TEMPLATE_REF_ERROR =
  'must be an immutable E2B build reference in the form <template>:<build-id>'

export const IMMUTABLE_DAYTONA_SNAPSHOT_REF_ERROR =
  'must be an immutable Daytona snapshot ID, not a snapshot name'

export const SANDBOX_RELEASE_GENERATION_ERROR = 'must be a positive safe integer release generation'

export const SANDBOX_PROVIDER_IDS = ['e2b', 'daytona'] as const
export type SandboxProviderName = (typeof SANDBOX_PROVIDER_IDS)[number]

/** Leaves three decimal digits for a materializer revision in one safe integer. */
export const MAX_SANDBOX_RELEASE_GENERATION = Math.floor((Number.MAX_SAFE_INTEGER - 999) / 1000)

const E2B_TEMPLATE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/
const E2B_TEMPLATE_REFERENCE_NAME_PATTERN =
  /^(?:[a-z0-9][a-z0-9_-]{0,62}\/)?[a-z0-9][a-z0-9_-]{0,62}$/

/** Normalizes a configured provider and rejects values outside the supported registry. */
export function normalizeSandboxProvider(
  value: string | undefined
): SandboxProviderName | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  return SANDBOX_PROVIDER_IDS.find((provider) => provider === normalized)
}

/** E2B template families use the provider's untagged, lowercase name grammar. */
export function isValidE2BTemplateName(value: string): boolean {
  return E2B_TEMPLATE_NAME_PATTERN.test(value)
}

/** Exact E2B refs may include one documented lowercase namespace segment. */
export function isValidE2BTemplateReferenceName(value: string): boolean {
  return E2B_TEMPLATE_REFERENCE_NAME_PATTERN.test(value)
}

/** Validates the monotonic release identity operators deploy with a Function base. */
export function isValidSandboxReleaseGeneration(value: string | number): boolean {
  const generation = typeof value === 'number' ? value : Number(value)
  return (
    Number.isSafeInteger(generation) &&
    generation > 0 &&
    generation <= MAX_SANDBOX_RELEASE_GENERATION &&
    String(generation) === String(value)
  )
}

/**
 * E2B resolves `<template>:<build-id>` directly to one immutable template build.
 * Human tags are deliberately rejected because E2B permits reassigning them.
 */
export function isImmutableE2BTemplateRef(value: string): boolean {
  const separator = value.lastIndexOf(':')
  if (separator <= 0 || separator === value.length - 1) return false

  const template = value.slice(0, separator)
  const buildId = value.slice(separator + 1)
  return isValidE2BTemplateReferenceName(template) && isValidUuid(buildId)
}

/** Daytona accepts a snapshot ID anywhere it accepts a name; only the ID is immutable. */
export function isImmutableDaytonaSnapshotRef(value: string): boolean {
  return isValidUuid(value)
}

/** Builds the exact E2B reference operators should deploy after a successful build. */
export function immutableE2BTemplateRef(templateName: string, buildId: string): string {
  const ref = `${templateName}:${buildId}`
  if (!isImmutableE2BTemplateRef(ref)) {
    throw new Error(`E2B template reference ${IMMUTABLE_E2B_TEMPLATE_REF_ERROR}`)
  }
  return ref
}
