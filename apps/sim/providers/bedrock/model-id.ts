/** Cross-region inference profile prefixes Bedrock prepends to a base model ID. */
export const GEO_PROFILE_PREFIX_PATTERN = /^(us-gov|us|eu|apac|au|ca|jp|global)\./

/** Strips Sim's namespace and geographic profile to find the canonical capability model. */
export function getBedrockBaseModelId(modelId: string): string {
  return modelId.replace(/^bedrock\//i, '').replace(GEO_PROFILE_PREFIX_PATTERN, '')
}
