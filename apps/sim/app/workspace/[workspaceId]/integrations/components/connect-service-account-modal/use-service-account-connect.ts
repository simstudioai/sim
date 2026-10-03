'use client'

import { type ComponentType, useMemo } from 'react'
import {
  getServiceAccountConnectNoun,
  getServiceAccountGatingBlockType,
} from '@/lib/credentials/service-account-provider-ids'
/**
 * Imported from the module rather than the `@/lib/integrations` barrel: the
 * barrel builds `POPULAR_WORKFLOWS` by calling `getAllBlockMeta()` at module
 * load, so importing it from a leaf component drags the whole block registry
 * into that component's graph.
 */
import {
  getServiceAccountFamilyIcon,
  getServiceAccountFamilyName,
} from '@/lib/integrations/credential-display'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import type { ServiceAccountProviderId } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/connect-service-account-modal'
import { getBlock } from '@/blocks'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import { isHiddenUnder, overlayVisibility } from '@/blocks/visibility/context'

/**
 * Everything a caller needs to render a service-account connect control:
 * whether to show it at all, what to call it, and the props the modal takes.
 */
export interface ServiceAccountConnectTarget {
  serviceAccountProviderId: ServiceAccountProviderId
  /**
   * Name the setup surface is titled with — the vendor ("Atlassian") for a
   * family service account, not the product page you opened it from.
   */
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
  /**
   * Vendor-accurate control label — token-paste and client-credential
   * providers use their own noun ("Add API key", "Add server-to-server app");
   * only true service-account providers say "Add service account".
   */
  label: string
  /**
   * True when the provider's setup surface must stay hidden for this viewer.
   * Custom Slack bots follow the released `slack_v2` block's visibility, so a
   * hosted kill switch applies consistently across integrations and chat.
   */
  hidden: boolean
}

interface UseServiceAccountConnectTargetArgs {
  serviceAccountProviderId: ServiceAccountProviderId | undefined
  serviceName: string | undefined
  serviceIcon: ComponentType<{ className?: string }> | undefined
}

/**
 * Derives the connect-control label and block visibility for a service-account
 * provider. Shared by the integrations detail page and the chat's inline
 * connect button so the two can't drift on either the wording or the gate.
 */
export function useServiceAccountConnectTarget({
  serviceAccountProviderId,
  serviceName,
  serviceIcon,
}: UseServiceAccountConnectTargetArgs): ServiceAccountConnectTarget | null {
  const blockOverlayVersion = useCustomBlockOverlayVersion()

  const isSlackBot = serviceAccountProviderId === SLACK_CUSTOM_BOT_PROVIDER_ID

  const hidden = useMemo(() => {
    const gatingBlockType = serviceAccountProviderId
      ? getServiceAccountGatingBlockType(serviceAccountProviderId)
      : null
    if (!gatingBlockType) return false
    const gatingBlock = getBlock(gatingBlockType)
    return !gatingBlock || isHiddenUnder(overlayVisibility(), gatingBlock)
    // blockOverlayVersion is read to re-evaluate when the overlay changes.
  }, [serviceAccountProviderId, blockOverlayVersion])

  return useMemo(() => {
    if (!serviceAccountProviderId || !serviceName || !serviceIcon) return null

    const label = isSlackBot
      ? 'Set up a custom bot'
      : `Add ${getServiceAccountConnectNoun(serviceAccountProviderId)}`

    const familyName = getServiceAccountFamilyName(serviceAccountProviderId)
    const familyIcon = getServiceAccountFamilyIcon(serviceAccountProviderId)

    return {
      serviceAccountProviderId,
      serviceName: familyName ?? serviceName,
      serviceIcon: familyIcon ?? serviceIcon,
      label,
      hidden,
    }
  }, [serviceAccountProviderId, serviceName, serviceIcon, isSlackBot, hidden])
}
