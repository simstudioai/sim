/**
 * Shared types for the integrations catalog. Mirrors the JSON shape written by
 * `scripts/generate-docs.ts` → `writeIntegrationsJson()`, which is the
 * serialized projection of `BlockConfig` consumed by workspace UIs and docs.
 */

import type { IntegrationMetadata } from '@sim/deployment-config/integration-metadata'
import type { BlockConfig, IntegrationTag } from '@/blocks/types'

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

/**
 * Public catalog entry: shared identity and authentication metadata plus
 * descriptions, operations, and triggers.
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
}
