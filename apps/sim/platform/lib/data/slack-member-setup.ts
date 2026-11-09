'use client'

import { useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  hasSlackSearchUserScopes,
  SLACK_SEARCH_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'
import { isDesktopApp } from '@/lib/desktop'
import { connectDesktopSource } from '@/lib/desktop/source-connect'
import { toast } from '@/lib/toast/sink'
import { useStartSlackCredentialGroupConfiguration } from '@/hooks/queries/credential-groups'
import { useOrganizationAccounts } from '@/hooks/queries/organization-accounts'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import { useSlackSearchInstallations } from '@/hooks/queries/slack-search'
import { organizationAccountsKeys } from '@/hooks/queries/utils/organization-accounts-keys'
import { slackSearchKeys } from '@/hooks/queries/utils/slack-search-keys'
import { slackSetupFor } from '@/platform/lib/data/slack-search-model'

const CHANNEL_NAME = 'slack-managed-users'
const AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1000

interface SlackManagedUsersMessage {
  type: typeof CHANNEL_NAME
  ok: boolean
  reason?: string
  state?: string
  credentialGroupId?: string
}

function isSlackManagedUsersMessage(value: unknown): value is SlackManagedUsersMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return (
    message.type === CHANNEL_NAME &&
    typeof message.ok === 'boolean' &&
    (message.reason === undefined || typeof message.reason === 'string') &&
    (message.state === undefined || typeof message.state === 'string') &&
    (message.credentialGroupId === undefined || typeof message.credentialGroupId === 'string')
  )
}

/** `optionActive` is undefined until the organization has a Slack sign-in option. */
function memberAccountsMessage(previousAppSetup: boolean, optionActive: boolean | undefined) {
  if (previousAppSetup)
    return 'Remove app setup on the Slack source to clear the previous Slack app first.'
  if (optionActive === undefined) return 'Verify member permissions in your Slack workspace.'
  if (!optionActive) return 'Enable Slack in Credential Groups to verify member permissions.'
  return 'Verify member permissions. Members will need to reconnect if their app or permissions change.'
}

interface SlackMemberSetupOptions {
  organizationId: string
  credentialGroupId: string
  onOpenChange: (open: boolean) => void
}

/**
 * Member Slack access for a Credential Group, through the organization's Sim Search app: the
 * legacy managed-users setup for an organization, always open and with no workspace bots to choose
 * from. It verifies member permissions in a Slack popup (or the desktop app's browser), listens for
 * the callback on the same broadcast channel, and refreshes the server-read section once Slack is
 * configured. `dismissOnly` is a shared app that needs nothing more; `hidden` is one already ready,
 * which closes the setup. Installing or managing the Sim Search app opens `appSetup`, the Slack
 * Settings page's setup, over this one, which stays open until it closes.
 */
export function useSlackMemberSetup({
  organizationId,
  credentialGroupId,
  onOpenChange,
}: SlackMemberSetupOptions) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const startAuthorization = useStartSlackCredentialGroupConfiguration()
  const [appId, setAppId] = useState('')
  /** Taken when the setup opens, so a refetch it causes cannot swap the dialog mid-flow. */
  const [appSetup, setAppSetup] = useState<ReturnType<typeof slackSetupFor> | null>(null)
  const appSetupOpen = appSetup !== null
  const apps = useSlackSearchInstallations(organizationId)
  const availableApps = apps.data?.installations ?? []
  const selectedApp =
    availableApps.find((app) => app.appId === appId) ??
    (availableApps.length === 1 && !appId ? availableApps[0] : undefined)
  const sharedAppInstalled = selectedApp?.appKind === 'shared'
  const noInstalledApp = apps.isSuccess && availableApps.length === 0
  /** The shared app connects member accounts without a Search bot installation. */
  const sharedAppWithoutBot = noInstalledApp && Boolean(apps.data?.sharedAppAvailable)
  const previousAppSetup = sharedAppWithoutBot && apps.data?.memberAppKind === 'custom'
  const sharedSetup = sharedAppInstalled || sharedAppWithoutBot
  const searchPolicies = useSearchIntegrations(organizationId, { enabled: sharedSetup })
  const searchApproved = searchPolicies.data?.some(
    (policy) => policy.connectorType === 'slack' && policy.approved
  )
  const accounts = useOrganizationAccounts(sharedSetup ? organizationId : undefined)
  const memberGroup = accounts.data?.credentialGroup
  const memberOption = memberGroup?.options.find((option) => option.provider === 'slack')
  const memberSetupSettled =
    accounts.isSuccess &&
    !accounts.isFetching &&
    !accounts.error &&
    searchPolicies.isSuccess &&
    !searchPolicies.isFetching &&
    !searchPolicies.error &&
    memberGroup?.id === credentialGroupId
  const sharedAppCanAuthorize = Boolean(
    sharedAppInstalled &&
      apps.isSuccess &&
      !apps.isFetching &&
      !apps.error &&
      apps.data?.sharedAppAvailable &&
      selectedApp.enabled &&
      !selectedApp.needsValidation &&
      memberSetupSettled &&
      memberOption?.status === 'active'
  )
  const memberOnlyCanAuthorize =
    sharedAppWithoutBot &&
    !previousAppSetup &&
    !apps.isFetching &&
    memberSetupSettled &&
    (!memberOption || memberOption.status === 'active')
  const searchPermissionsMissing =
    searchApproved && !hasSlackSearchUserScopes(memberOption?.requiredScopes)
  const sharedAppReady =
    (sharedAppCanAuthorize || memberOnlyCanAuthorize) &&
    memberOption?.configurationStatus === 'ready' &&
    !searchPermissionsMissing
  const sharedAppNeedsUpdate =
    sharedAppCanAuthorize &&
    (memberOption?.configurationStatus === 'needs_update' ||
      (memberOption?.configurationStatus === 'ready' && searchPermissionsMissing))
  const [pending, setPending] = useState(false)
  const expectedState = useRef<string | null>(null)
  const popup = useRef<Window | null>(null)
  const nativeAbort = useRef<AbortController | null>(null)
  const authorizationTimeout = useRef<number | null>(null)
  const requiredScopes = selectedApp || sharedAppWithoutBot ? [...SLACK_SEARCH_USER_SCOPES] : []

  const reset = () => {
    nativeAbort.current?.abort()
    nativeAbort.current = null
    popup.current?.close()
    popup.current = null
    if (authorizationTimeout.current !== null) window.clearTimeout(authorizationTimeout.current)
    authorizationTimeout.current = null
    expectedState.current = null
    setAppId('')
    setAppSetup(null)
    setPending(false)
    startAuthorization.reset()
  }

  const configured = () => {
    void queryClient.invalidateQueries({
      queryKey: organizationAccountsKeys.detail(organizationId),
    })
    void queryClient.invalidateQueries({ queryKey: slackSearchKeys.list(organizationId) })
    toast.success('Slack configured')
    router.refresh()
    onOpenChange(false)
    reset()
  }

  const handleAuthorizationMessage = (message: SlackManagedUsersMessage) => {
    if (!expectedState.current || message.state !== expectedState.current) return
    expectedState.current = null
    if (authorizationTimeout.current !== null) window.clearTimeout(authorizationTimeout.current)
    authorizationTimeout.current = null
    popup.current?.close()
    popup.current = null
    setPending(false)
    if (!message.ok) {
      if (message.reason === 'provider_error') toast.warning('Slack authorization canceled')
      else toast.error('Slack app verification failed. Please try again.')
      return
    }
    if (message.credentialGroupId !== credentialGroupId) {
      toast.error('Slack app verification failed. Please try again.')
      return
    }
    configured()
  }

  /** A ref keeps a refetch from reopening the channel and dropping a queued authorization message. */
  const messageHandler = useRef(handleAuthorizationMessage)
  useEffect(() => {
    messageHandler.current = handleAuthorizationMessage
  })

  useEffect(() => {
    if (sharedAppReady) return
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isSlackManagedUsersMessage(event.data)) return
      messageHandler.current(event.data)
    }
    return () => channel.close()
  }, [sharedAppReady])

  useEffect(() => {
    if (sharedAppReady && !appSetupOpen) onOpenChange(false)
  }, [sharedAppReady, appSetupOpen, onOpenChange])

  useEffect(
    () => () => {
      nativeAbort.current?.abort()
      if (authorizationTimeout.current !== null) window.clearTimeout(authorizationTimeout.current)
      popup.current?.close()
      popup.current = null
      authorizationTimeout.current = null
      expectedState.current = null
    },
    []
  )

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) reset()
  }

  const handleSubmit = async () => {
    if (
      pending ||
      (sharedAppInstalled && !sharedAppNeedsUpdate) ||
      (sharedAppWithoutBot && !memberOnlyCanAuthorize) ||
      !requiredScopes.length
    )
      return
    const body = {
      ...(selectedApp ? { appId: selectedApp.appId, teamId: selectedApp.teamId } : {}),
      requiredScopes,
    }

    if (isDesktopApp()) {
      const controller = new AbortController()
      nativeAbort.current = controller
      setPending(true)
      try {
        await connectDesktopSource(
          {
            kind: 'slack-managed-users',
            owner: { organizationId },
            credentialGroupId,
            body,
          },
          controller.signal
        )
        controller.signal.throwIfAborted()
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: organizationAccountsKeys.detail(organizationId),
          }),
          queryClient.invalidateQueries({ queryKey: slackSearchKeys.list(organizationId) }),
        ])
        controller.signal.throwIfAborted()
        configured()
      } catch (failure) {
        if (!controller.signal.aborted)
          toast.error(getErrorMessage(failure, 'Could not connect Slack'))
      } finally {
        if (nativeAbort.current === controller) {
          nativeAbort.current = null
          setPending(false)
        }
      }
      return
    }
    const opened = window.open('about:blank', 'slack-managed-users', 'width=720,height=760')
    if (!opened) {
      toast.error('Allow popups to verify the Slack app')
      return
    }
    popup.current = opened
    setPending(true)
    try {
      const result = await startAuthorization.mutateAsync({
        organizationId,
        credentialGroupId,
        body,
      })
      if (popup.current !== opened) return
      expectedState.current = result.state
      opened.location.href = result.authorizationUrl
      /** COOP can report a live OAuth popup as closed; only the deadline expires its state. */
      authorizationTimeout.current = window.setTimeout(() => {
        if (popup.current !== opened) return
        authorizationTimeout.current = null
        opened.close()
        popup.current = null
        expectedState.current = null
        setPending(false)
        toast.error('Slack authorization expired. Please try again.')
      }, AUTHORIZATION_TIMEOUT_MS)
    } catch (authorizationError) {
      if (popup.current !== opened) return
      opened.close()
      popup.current = null
      setPending(false)
      toast.error(getErrorMessage(authorizationError, 'Could not start Slack authorization'))
    }
  }

  const needsApp = noInstalledApp && !sharedAppWithoutBot
  const checkingSetup =
    apps.isPending ||
    (sharedSetup &&
      (apps.isFetching ||
        accounts.isPending ||
        accounts.isFetching ||
        searchPolicies.isPending ||
        searchPolicies.isFetching))
  const failedSetup = apps.error
    ? apps
    : sharedSetup && searchPolicies.error
      ? searchPolicies
      : sharedSetup && accounts.error
        ? accounts
        : null

  return {
    hidden: sharedAppReady && !appSetupOpen,
    dismissOnly: sharedAppInstalled && !sharedAppNeedsUpdate,
    checkingSetup,
    failure: failedSetup
      ? {
          message: failedSetup.error?.message ?? 'Could not check the Slack app',
          retrying: failedSetup.isFetching,
          retry: () => void failedSetup.refetch(),
        }
      : null,
    sharedAppWithoutBot,
    memberAccountsCopy: memberAccountsMessage(
      previousAppSetup,
      memberOption && memberOption.status === 'active'
    ),
    needsApp,
    pending,
    primaryLabel: pending
      ? 'Waiting for Slack…'
      : sharedAppNeedsUpdate || (sharedAppWithoutBot && memberOption)
        ? 'Update member access'
        : 'Verify and add',
    primaryDisabled:
      pending ||
      checkingSetup ||
      Boolean(failedSetup) ||
      (sharedAppWithoutBot && !memberOnlyCanAuthorize) ||
      !requiredScopes.length,
    handleOpenChange,
    handleSubmit,
    appOptions: availableApps.map((app) => ({ value: app.appId, label: app.teamName })),
    selectedApp,
    setAppId,
    appSetup: appSetup && { ...appSetup, close: () => setAppSetup(null) },
    openAppSetup: () => {
      if (apps.data) setAppSetup(slackSetupFor(apps.data, selectedApp))
    },
  }
}
