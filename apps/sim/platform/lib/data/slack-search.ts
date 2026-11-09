'use client'

import { useEffect, useRef } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import type { SlackSearchInstallationView } from '@/lib/api/contracts/knowledge/slack'
import { isDesktopApp } from '@/lib/desktop'
import {
  SLACK_SEARCH_DEFAULT_DESCRIPTION,
  SLACK_SEARCH_DEFAULT_NAME,
} from '@/lib/slack-search/manifest'
import { toast } from '@/lib/toast/sink'
import {
  useConfigureSlackSearch,
  useConnectCustomSlackSearch,
  useRemoveSlackSearch,
  useSlackSearchInstallations,
  useSlackSearchManifest,
  useStartSlackSearchOAuth,
} from '@/hooks/queries/slack-search'
import type {
  SetupTarget,
  SlackSearchConsole,
  SlackSetupFlow,
} from '@/platform/lib/data/slack-search-model'

/** Where the Slack OAuth round trip comes back: the completion page marks it `complete`. */
const setupResultParser = parseAsStringLiteral(['complete']).withOptions({ history: 'replace' })

/**
 * The organization's Slack Search installations and the row actions that change them, with the
 * notice for a finished OAuth round trip.
 */
export function useLiveSlackSearch(organizationId: string): SlackSearchConsole {
  const installations = useSlackSearchInstallations(organizationId)
  const configure = useConfigureSlackSearch()
  const remove = useRemoveSlackSearch()
  const [setupResult, setSetupResult] = useQueryState('slackSetup', setupResultParser)
  const toastShown = useRef(false)

  useEffect(() => {
    if (setupResult !== 'complete' || toastShown.current) return
    toastShown.current = true
    toast.success('Slack connected')
    void setSetupResult(null)
  }, [setupResult, setSetupResult])

  return {
    list: installations.data ?? (installations.error ? null : undefined),
    retry: () => void installations.refetch(),
    busy: configure.isPending || remove.isPending,
    canSetUp: true,
    updateError: configure.error?.message,
    toggle: (installation: SlackSearchInstallationView) =>
      configure.mutate({
        organizationId,
        credentialId: installation.credentialId,
        enabled: !installation.enabled,
      }),
    remove: async (installation) => {
      remove.reset()
      await remove.mutateAsync({ organizationId, installationId: installation.id })
    },
  }
}

/**
 * The setup flow behind one dialog: the organization's own manifest, the shared app's consent, and
 * a custom app's credentials. A browser leaves for Slack; the desktop app runs consent in the
 * user's browser and closes the dialog when it returns.
 */
export function useLiveSlackSetup(
  organizationId: string,
  target: SetupTarget,
  botName: string | undefined,
  close: () => void
): SlackSetupFlow {
  const nativeAbort = useRef<AbortController | null>(null)
  useEffect(() => () => nativeAbort.current?.abort(), [])
  const name = botName ?? SLACK_SEARCH_DEFAULT_NAME
  const description = SLACK_SEARCH_DEFAULT_DESCRIPTION
  const prepare = useSlackSearchManifest(organizationId, name)
  const oauth = useStartSlackSearchOAuth()
  const connect = useConnectCustomSlackSearch()
  const installationId = target.previous?.id

  return {
    manifest: prepare.data
      ? { manifest: prepare.data.manifest, createAppUrl: prepare.data.createAppUrl }
      : undefined,
    existingAppId: target.previous?.appId ?? prepare.data?.existingApp?.appId,
    sharedAvailable: Boolean(prepare.data?.sharedAppId),
    manifestError: prepare.error?.message,
    retryManifest: () => void prepare.refetch(),
    retrying: prepare.isFetching,
    pending: connect.isPending || (oauth.isPending && !isDesktopApp()),
    close: () => {
      nativeAbort.current?.abort()
      close()
    },
    installShared: () => {
      const controller = new AbortController()
      nativeAbort.current = controller
      const started = oauth
        .mutateAsync({
          organizationId,
          installationId,
          name,
          description,
          mode: 'shared',
          signal: controller.signal,
        })
        .then((result) => {
          if (result) window.location.assign(result.authorizationUrl)
          else close()
          return false
        })
      if (!isDesktopApp()) return started
      started.catch((error) =>
        toast.error(getErrorMessage(error, 'Could not connect Sim Search to Slack'))
      )
      return false
    },
    connect: async ({ botToken, clientId, clientSecret, signingSecret }) => {
      await connect.mutateAsync({
        organizationId,
        installationId,
        name,
        description,
        botToken: botToken.trim(),
        ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        ...(signingSecret.trim() ? { signingSecret: signingSecret.trim() } : {}),
      })
    },
  }
}
