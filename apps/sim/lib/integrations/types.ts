/**
 * Shared types for the integrations catalog. Mirrors the JSON shape written by
 * `scripts/generate-docs.ts` → `writeIntegrationsJson()`, which is the
 * serialized projection of `BlockConfig` consumed by landing + workspace UIs.
 */

import type { IntegrationMetadata } from '@sim/deployment-config/integration-metadata'
import type { IntegrationLandingContent } from '@/app/(landing)/integrations/data/types'
import type { BlockConfig, IntegrationTag } from '@/blocks/types'

/** Normalized authentication mode surfaced in the catalog. */
export type AuthType = IntegrationMetadata['authType']

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
 * Public catalog entry: shared identity and authentication metadata plus
 * descriptions, operations, triggers, and landing content.
 */
export interface Integration extends IntegrationMetadata {
  description: BlockConfig['description']
  longDescription: NonNullable<BlockConfig['longDescription']>
  category: BlockConfig['category']
  integrationType: NonNullable<BlockConfig['integrationType']>
  /** Tags sourced from the block's `*BlockMeta` export at generation time. */
  tags?: IntegrationTag[]
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
  /** Hand-authored landing content baked in at generation time (see `landing-content.ts`). */
  landingContent?: IntegrationLandingContent
}

/**
 * The fields the `/integrations` catalog grid actually renders and searches
 * by, plus a precomputed, lowercased `searchFields` index (name, description,
 * every operation's name and description, every trigger's name) in place of
 * the full `operations`/`triggers` arrays. Shipping the full `Integration[]`
 * to that page's client component embeds every integration's complete field
 * set - including data the grid never renders (`tags`, `docsUrl`,
 * `landingContent`, ...) - in the initial HTML/RSC payload.
 *
 * `searchFields` stays an array, one entry per source field, rather than a
 * single joined string: matching must still require the query to fall
 * entirely within one field (as the original per-field `Integration[]`
 * search did), not span a field boundary a single concatenated string would
 * silently allow.
 */
export interface IntegrationSummary {
  type: Integration['type']
  slug: string
  name: Integration['name']
  description: Integration['description']
  bgColor: Integration['bgColor']
  integrationType: Integration['integrationType']
  searchFields: readonly string[]
}
