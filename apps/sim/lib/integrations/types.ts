/**
 * Shared types for the integrations catalog. Mirrors the JSON shape written by
 * `scripts/generate-docs.ts` → `writeIntegrationsJson()`, which is the
 * serialized projection of `BlockConfig` consumed by landing + workspace UIs.
 */

import type { IntegrationLandingContent } from '@/app/(landing)/integrations/data/types'
import type { BlockConfig, IntegrationTag } from '@/blocks/types'

/** Normalized authentication mode surfaced in the catalog. */
export type AuthType = 'oauth' | 'api-key' | 'none'

/** Trigger entry enriched from the trigger registry at generation time. */
interface TriggerInfo {
  id: string
  name: string
  description: string
}

/** Operation entry enriched from the tool registry at generation time. */
interface OperationInfo {
  name: string
  description: string
}

/** Single FAQ item rendered on a per-integration landing page. */
export interface FAQItem {
  question: string
  answer: string
}

/**
 * Catalog projection of a `BlockConfig`. Direct `BlockConfig` fields are
 * referenced via indexed access so the two stay in lockstep; the remaining
 * fields are generation-time enrichments (see `scripts/generate-docs.ts`).
 */
export interface Integration {
  type: BlockConfig['type']
  name: BlockConfig['name']
  description: BlockConfig['description']
  longDescription: NonNullable<BlockConfig['longDescription']>
  category: BlockConfig['category']
  integrationType: NonNullable<BlockConfig['integrationType']>
  bgColor: BlockConfig['bgColor']
  /** Tags sourced from the block's `*BlockMeta` export at generation time. */
  tags?: IntegrationTag[]
  /** URL slug derived from `name`. */
  slug: string
  /** Name of the React icon component (resolved client-side via `blockTypeToIconMap`). */
  iconName: string
  /** Canonical docs URL for the integration. */
  docsUrl: string
  /** Operations enriched with descriptions from the tool registry. */
  operations: OperationInfo[]
  operationCount: number
  /** Triggers enriched with details from the trigger registry. */
  triggers: TriggerInfo[]
  triggerCount: number
  /** Authentication mode inferred from `BlockConfig.subBlocks`. */
  authType: AuthType
  /**
   * OAuth service id from the block's `oauth-input` subBlock (a service key in
   * `OAUTH_PROVIDERS`). Present exactly when `authType` is `'oauth'`.
   */
  oauthServiceId?: string
  /** Hand-authored landing content baked in at generation time (see `landing-content.ts`). */
  landingContent?: IntegrationLandingContent
}
