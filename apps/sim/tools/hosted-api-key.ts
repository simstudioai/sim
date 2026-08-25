import type { ToolConfig } from '@/tools/types'

/**
 * Whether Sim supplies the API key for a tool, or the caller must bring one.
 *
 * - `always` — the tool declares hosted-key support unconditionally.
 * - `conditional` — hosted-key support applies only to some parameter
 *   combinations, decided at execution time by `hosting.enabled`.
 * - `none` — the tool has no hosted key; the caller always brings their own.
 *
 * Derived rather than published raw because `ToolHostingConfig` holds closures
 * (`enabled`, `pricing`), which is why `hosting` is on the tool-metadata
 * generator's exclusion list. "Does Sim host the key" is a first-order
 * authoring question, so the *answer* is emitted even though the config is not.
 */
export type HostedApiKeySupport = 'always' | 'conditional' | 'none'

/** Projects a tool's `hosting` config down to its serializable hosted-key answer. */
export function deriveHostedApiKeySupport(hosting: ToolConfig['hosting']): HostedApiKeySupport {
  if (!hosting) return 'none'
  return hosting.enabled ? 'conditional' : 'always'
}
