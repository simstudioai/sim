import { INTEGRATION_TOTALS } from '@sim/deployment-config/integration-totals'
import { COVER_OG_SIZE, createCoverOgImage } from '@/lib/og/cover-image'

export const contentType = 'image/png'
export const size = COVER_OG_SIZE

export default async function Image() {
  return createCoverOgImage({
    title: 'Integrations',
    subtitle: `Connect ${INTEGRATION_TOTALS.integrations} apps and services and ${INTEGRATION_TOTALS.actions}+ tools to AI agents in Sim — visually, conversationally, or with code.`,
  })
}
