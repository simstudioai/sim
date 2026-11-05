'use client'

import { useMothershipChatEvents } from '@/hooks/use-mothership-chat-events'
import { useSeedDeploymentShape } from '@/hooks/use-seed-deployment-shape'
import { useOrganization } from '@/platform/lib/data/organization'

/** The legacy organization provider's chat stream: live list and running state, nothing rendered. */
export function LiveChatEvents() {
  const { organization, deployment, mothershipAvailable, searchAccess } = useOrganization()
  useSeedDeploymentShape(deployment)
  useMothershipChatEvents(
    mothershipAvailable || searchAccess.memberScoped
      ? { organizationId: organization.id }
      : undefined,
    deployment.chatEnabled
  )
  return null
}
