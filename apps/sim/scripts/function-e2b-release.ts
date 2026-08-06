import {
  IMMUTABLE_E2B_TEMPLATE_REF_ERROR,
  isImmutableE2BTemplateRef,
  isValidSandboxReleaseGeneration,
  SANDBOX_RELEASE_GENERATION_ERROR,
} from '@sim/utils/sandbox-references'

export const FUNCTION_E2B_DEFAULT_BASE_TEMPLATE = 'code-interpreter-v1'

/** Resolves the maintained E2B base or an explicit immutable override. */
export function functionE2BBaseTemplate(args: readonly string[]): string {
  const baseIndex = args.indexOf('--base-template')
  if (baseIndex === -1) return FUNCTION_E2B_DEFAULT_BASE_TEMPLATE

  const value = args[baseIndex + 1]
  if (!value || value.startsWith('--') || !isImmutableE2BTemplateRef(value)) {
    throw new Error(`--base-template ${IMMUTABLE_E2B_TEMPLATE_REF_ERROR}`)
  }
  return value
}

/** Resolves a monotonic release generation and prevents accidental reuse. */
export function functionE2BReleaseGeneration(
  args: readonly string[],
  configuredCurrentGeneration?: string,
  now: number = Date.now()
): number {
  const generationIndex = args.indexOf('--generation')
  const explicitValue = generationIndex === -1 ? undefined : args[generationIndex + 1]
  if (
    generationIndex !== -1 &&
    (!explicitValue ||
      explicitValue.startsWith('--') ||
      !isValidSandboxReleaseGeneration(explicitValue))
  ) {
    throw new Error(`--generation ${SANDBOX_RELEASE_GENERATION_ERROR}`)
  }

  const generation = explicitValue === undefined ? now : Number(explicitValue)
  if (!isValidSandboxReleaseGeneration(generation)) {
    throw new Error(`Generated release generation ${SANDBOX_RELEASE_GENERATION_ERROR}`)
  }
  if (configuredCurrentGeneration !== undefined) {
    if (!isValidSandboxReleaseGeneration(configuredCurrentGeneration)) {
      throw new Error(
        `Configured E2B_FUNCTION_TEMPLATE_GENERATION ${SANDBOX_RELEASE_GENERATION_ERROR}`
      )
    }
    if (generation <= Number(configuredCurrentGeneration)) {
      throw new Error(
        `--generation must be greater than the configured E2B_FUNCTION_TEMPLATE_GENERATION (${configuredCurrentGeneration})`
      )
    }
  }
  return generation
}
