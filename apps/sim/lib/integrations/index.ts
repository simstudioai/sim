/** Canonical, browser-safe projection generated from the block registry. */
import integrationsJson from '@sim/deployment-config/integrations.json'
import type { Integration } from '@/lib/integrations/types'

/** All integrations surfaced in the catalog, ordered by `scripts/generate-docs.ts`. */
export const INTEGRATIONS: readonly Integration[] =
  integrationsJson.integrations as readonly Integration[]

export {
  type CredentialDisplay,
  resolveCredentialDisplay,
} from '@/lib/integrations/credential-display'
export { blockTypeToIconMap } from '@/lib/integrations/icon-mapping'
export {
  type OAuthServiceMatch,
  resolveOAuthServiceForIntegration,
  resolveOAuthServiceForSlug,
} from '@/lib/integrations/oauth-service'
export type { Integration } from '@/lib/integrations/types'
export type { BlockMeta, BlockTemplate } from '@/blocks/types'
export { formatIntegrationType } from '@/blocks/types'
