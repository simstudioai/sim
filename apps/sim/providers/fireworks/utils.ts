/**
 * Wire model names for the static hosted Fireworks catalog entries (the
 * sim-auto pool). Catalog ids are the short `fireworks/<name>` form; the
 * Fireworks API requires the full serverless resource path. User-configured
 * dynamic ids are sent verbatim after prefix-stripping, exactly as before —
 * only ids in this map are rewritten.
 */
const FIREWORKS_WIRE_NAMES: Record<string, string> = {
  'glm-5.2': 'accounts/fireworks/models/glm-5p2',
  'kimi-k3': 'accounts/fireworks/models/kimi-k3',
}

/**
 * Resolves the wire model name Fireworks expects from a prefix-stripped
 * catalog id.
 */
export function resolveFireworksWireModel(strippedModel: string): string {
  return FIREWORKS_WIRE_NAMES[strippedModel] ?? strippedModel
}
