'use client'

import { type ComponentType, useMemo } from 'react'
import { getClientCredentialAccountDescriptor } from '@/lib/credentials/client-credential-accounts/descriptors'
import { getTokenServiceAccountDescriptor } from '@/lib/credentials/token-service-accounts/descriptors'
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
   * Custom Slack bots ride the `slack_v2` preview flag, so any surface that
   * offers one — the integrations page or the chat — has to honour it or the
   * flag is trivially bypassed.
   */
  hidden: boolean
}

interface UseServiceAccountConnectTargetArgs {
  serviceAccountProviderId: ServiceAccountProviderId | undefined
  serviceName: string | undefined
  serviceIcon: ComponentType<{ className?: string }> | undefined
}

/**
 * Derives the connect-control label and preview gating for a service-account
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
    if (!isSlackBot) return false
    const v2 = getBlock('slack_v2')
    return !v2 || isHiddenUnder(overlayVisibility(), v2)
  }, [isSlackBot, blockOverlayVersion])

  return useMemo(() => {
    if (!serviceAccountProviderId || !serviceName || !serviceIcon) return null

    const nounDescriptor =
      getTokenServiceAccountDescriptor(serviceAccountProviderId) ??
      getClientCredentialAccountDescriptor(serviceAccountProviderId)

    const label = isSlackBot
      ? 'Set up a custom bot'
      : nounDescriptor
        ? `Add ${nounDescriptor.connectNoun}`
        : 'Add service account'

    return { serviceAccountProviderId, serviceName, serviceIcon, label, hidden }
  }, [serviceAccountProviderId, serviceName, serviceIcon, isSlackBot, hidden])
}
