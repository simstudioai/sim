import { isHiddenFromDisplay } from '@/blocks/types'
import type { HostedApiKeySupport } from '@/tools/hosted-api-key'
import { getToolMetadata, type ToolMetadata } from '@/tools/metadata'
import { getToolOutputsMetadata } from '@/tools/metadata-outputs'
import { resolveToolId } from '@/tools/tool-ids'
import type { ToolConfig } from '@/tools/types'

/**
 * Surface-neutral projection of a built-in tool.
 *
 * Reads `@/tools/metadata`, `@/tools/metadata-outputs`, and `@/tools/tool-ids` —
 * never `@/tools/registry`. Everything published here is plain data the
 * generator already emits; reaching the executable registry for it would add
 * ~4,700 modules to every graph that touches this module.
 */

/** One declared parameter of a tool. */
export interface CatalogToolParam {
  type: string
  required?: boolean
  visibility?: string
  description?: string
  default?: unknown
  /** JSON-Schema-shaped constraints for structured params. Provider-defined and arbitrarily nested. */
  items?: unknown
}

/** One declared output field of a tool. */
export interface CatalogToolOutput {
  type: string
  description?: string
  optional?: boolean
  nullable?: boolean
  properties?: Record<string, CatalogToolOutput>
  items?: { type: string; description?: string; properties?: Record<string, CatalogToolOutput> }
  fileConfig?: { mimeType?: string; extension?: string }
}

/**
 * Deployment facts a projection needs but must not read for itself.
 *
 * Passed in rather than imported so this module stays a pure function of its
 * arguments — the same reason `describeTool` is an option on the block detail
 * projection rather than a branch inside it.
 */
export interface CatalogDeployment {
  /**
   * Whether Sim supplies hosted API keys at all.
   *
   * False on every self-hosted deployment, where `injectHostedKeyIfNeeded`
   * short-circuits on `isHosted` and no tool ever receives a Sim-supplied key —
   * so a tool that *declares* hosted-key support still requires the caller to
   * bring one. Publishing the raw declaration there would tell 127 tools' worth
   * of callers they need no key when they do.
   */
  hostedKeys: boolean
}

/** OAuth requirement declared by a tool. */
export interface CatalogToolOAuth {
  required: boolean
  provider: string
  requiredScopes?: string[]
}

/** List-shaped view of a tool: identity, auth, and how its API key is supplied. */
export interface CatalogToolSummary {
  id: string
  name: string
  description: string
  version?: string
  hostedApiKey: HostedApiKeySupport
  oauth?: CatalogToolOAuth
}

/** A tool plus the parameters it accepts and the outputs it declares. */
export interface CatalogToolDetail extends CatalogToolSummary {
  params: Record<string, CatalogToolParam>
  outputs: Record<string, CatalogToolOutput>
}

function projectOAuth(oauth: ToolMetadata['oauth']): CatalogToolOAuth | undefined {
  if (!oauth) return undefined
  const projected: CatalogToolOAuth = { required: oauth.required, provider: oauth.provider }
  if (oauth.requiredScopes !== undefined) projected.requiredScopes = [...oauth.requiredScopes]
  return projected
}

/**
 * Projects tool metadata to its catalog summary under a resolved registry id.
 *
 * The id is passed in rather than read off the metadata because the registry
 * key is what `tools.access` and every caller reference, and the metadata's own
 * `id` field is authored separately from it.
 *
 * `name` and `description` fall back to the id: both are optional on the
 * generated artifact, and a catalog entry with an empty name is unusable.
 * `hostedApiKey` falls back to `none`, which is what an artifact generated
 * before the field existed means, and is forced to `none` wherever the
 * deployment supplies no hosted keys.
 */
export function projectToolSummary(
  toolId: string,
  metadata: ToolMetadata,
  deployment: CatalogDeployment
): CatalogToolSummary {
  const summary: CatalogToolSummary = {
    id: toolId,
    name: metadata.name ?? toolId,
    description: metadata.description ?? '',
    hostedApiKey: deployment.hostedKeys ? (metadata.hostedApiKey ?? 'none') : 'none',
  }
  if (metadata.version !== undefined) summary.version = metadata.version
  const oauth = projectOAuth(metadata.oauth)
  if (oauth) summary.oauth = oauth
  return summary
}

/** Projects one declared tool parameter. */
export function projectToolParams(
  params: ToolConfig['params'] | undefined
): Record<string, CatalogToolParam> {
  const projected: Record<string, CatalogToolParam> = {}
  for (const [id, param] of Object.entries(params ?? {})) {
    if (!param) continue
    const entry: CatalogToolParam = { type: param.type }
    if (param.required !== undefined) entry.required = param.required
    if (param.visibility !== undefined) entry.visibility = param.visibility
    if (param.description !== undefined) entry.description = param.description
    if (param.default !== undefined) entry.default = param.default
    if (param.items !== undefined) entry.items = param.items
    projected[id] = entry
  }
  return projected
}

/** Projects a tool's declared outputs, dropping any marked hidden from display. */
export function projectToolOutputs(
  outputs: NonNullable<ToolConfig['outputs']> | undefined
): Record<string, CatalogToolOutput> {
  const projected: Record<string, CatalogToolOutput> = {}
  for (const [id, output] of Object.entries(outputs ?? {})) {
    if (!output || isHiddenFromDisplay(output)) continue
    projected[id] = output as CatalogToolOutput
  }
  return projected
}

/**
 * Projects a tool to its full catalog entry, or `undefined` when no such tool
 * exists.
 *
 * The lookup resolves an unversioned name onto the newest version, exactly as
 * execution does, so `gmail_send` finds `gmail_send_v2`. The returned `id` is
 * the resolved one, so a caller can always see which version answered.
 */
export function projectToolDetail(
  toolId: string,
  deployment: CatalogDeployment
): CatalogToolDetail | undefined {
  const resolved = resolveToolId(toolId)
  const metadata = getToolMetadata(resolved)
  if (!metadata) return undefined
  return {
    ...projectToolSummary(resolved, metadata, deployment),
    params: projectToolParams(metadata.params),
    outputs: projectToolOutputs(getToolOutputsMetadata(resolved)),
  }
}

/** Projects a tool to its catalog summary, or `undefined` when no such tool exists. */
export function projectToolSummaryById(
  toolId: string,
  deployment: CatalogDeployment
): CatalogToolSummary | undefined {
  const resolved = resolveToolId(toolId)
  const metadata = getToolMetadata(resolved)
  return metadata ? projectToolSummary(resolved, metadata, deployment) : undefined
}
