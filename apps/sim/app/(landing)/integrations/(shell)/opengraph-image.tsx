import integrationsJson from '@sim/deployment-config/integrations.json'
import type { Integration } from '@/lib/integrations/types'
import { COVER_OG_SIZE, createCoverOgImage } from '@/lib/og/cover-image'

export const contentType = 'image/png'
export const size = COVER_OG_SIZE

/** Raw catalog JSON, not the barrel - keeps `@/blocks/registry` out of the OG bundle. */
const integrations = integrationsJson.integrations as readonly Integration[]
const TOTAL_TOOL_COUNT = integrations.reduce((sum, i) => sum + i.operationCount, 0)

export default async function Image() {
  return createCoverOgImage({
    title: 'Integrations',
    subtitle: `Connect ${integrations.length} apps and services and ${TOTAL_TOOL_COUNT}+ tools to AI agents in Sim — visually, conversationally, or with code.`,
  })
}
