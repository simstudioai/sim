import integrationsJson from '@/lib/integrations/integrations.json'
import type { Integration } from '@/lib/integrations/types'
import { createLandingOgImage } from '@/app/(landing)/og-utils'

export const contentType = 'image/png'
export const size = {
  width: 1200,
  height: 630,
}

/** Raw catalog JSON, not the barrel - keeps `@/blocks/registry` out of the OG bundle. */
const integrations = integrationsJson.integrations as readonly Integration[]
const TOTAL_TOOL_COUNT = integrations.reduce((sum, i) => sum + i.operationCount, 0)
const OAUTH_COUNT = integrations.filter((i) => i.authType === 'oauth').length
const TRIGGER_INTEGRATION_COUNT = integrations.filter((i) => i.triggerCount > 0).length

export default async function Image() {
  return createLandingOgImage({
    eyebrow: 'Sim integrations directory',
    title: 'Integrations',
    subtitle: `Connect ${integrations.length} apps and services to AI agents in Sim's workflow builder, visually, conversationally, or with code.`,
    pills: [
      `${integrations.length} integrations`,
      `${TOTAL_TOOL_COUNT}+ tools`,
      `${OAUTH_COUNT} OAuth apps`,
      `${TRIGGER_INTEGRATION_COUNT} with real-time triggers`,
    ],
    domainLabel: 'sim.ai/integrations',
  })
}
