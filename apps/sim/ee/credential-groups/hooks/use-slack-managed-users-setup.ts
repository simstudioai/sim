'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn-legacy'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import type { WorkspaceCredential } from '@/lib/api/contracts'
import type { OrganizationCredential } from '@/lib/api/contracts/organization-credentials'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import {
  hasSlackSearchUserScopes,
  resolveSlackManagedUserScopes,
  SLACK_MANAGED_USER_SCOPES,
  SLACK_SEARCH_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'
import { isDesktopApp } from '@/lib/desktop'
import { connectDesktopSource } from '@/lib/desktop/source-connect'
import { useStartSlackCredentialGroupConfiguration } from '@/hooks/queries/credential-groups'
import { useOrganizationAccounts } from '@/hooks/queries/organization-accounts'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import { useSlackSearchInstallations } from '@/hooks/queries/slack-search'
import { credentialGroupKeys } from '@/hooks/queries/utils/credential-group-queries'
import { organizationAccountsKeys } from '@/hooks/queries/utils/organization-accounts-keys'
import { slackSearchKeys } from '@/hooks/queries/utils/slack-search-keys'

const CHANNEL_NAME = 'slack-managed-users'
const AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1000

export interface SlackManagedUsersSetupOptions {
  bots: Array<WorkspaceCredential | OrganizationCredential>
  credentialGroupId: string
  initialCredentialId?: string
  initialRequiredScopes?: readonly string[]
  isLoading: boolean
  onOpenChange: (open: boolean) => void
  open: boolean
  workspaceId?: string
  organizationId?: string
}

interface SlackManagedUsersMessage {
  type: typeof CHANNEL_NAME
  ok: boolean
  reason?: string
  state?: string
  credentialGroupId?: string
  slackBotCredentialId?: string
}

function getSlackManagedUsersFailureNotification(reason?: string): {
  message: string
  variant: 'error' | 'warning'
} {
  return reason === 'provider_error'
    ? { message: 'Slack authorization canceled', variant: 'warning' }
    : { message: 'Slack app verification failed. Please try again.', variant: 'error' }
}

/** `optionActive` is undefined until the organization has a Slack sign-in option. */
function memberAccountsMessage(previousAppSetup: boolean, optionActive: boolean | undefined) {
  if (previousAppSetup)
    return 'Remove app setup on the Slack source to clear the previous Slack app first.'
  if (optionActive === undefined) return 'Verify member permissions in your Slack workspace.'
  if (!optionActive) return 'Enable Slack in Credential Groups to verify member permissions.'
  return 'Verify member permissions. Members will need to reconnect if their app or permissions change.'
}

function isSlackManagedUsersMessage(value: unknown): value is SlackManagedUsersMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return (
    message.type === CHANNEL_NAME &&
    typeof message.ok === 'boolean' &&
    (message.reason === undefined || typeof message.reason === 'string') &&
    (message.state === undefined || typeof message.state === 'string') &&
    (message.credentialGroupId === undefined || typeof message.credentialGroupId === 'string') &&
    (message.slackBotCredentialId === undefined || typeof message.slackBotCredentialId === 'string')
  )
}

/** The Slack member-access setup state machine, for whichever surface draws its dialog. */
export function useSlackManagedUsersSetup({
  bots,
  credentialGroupId,
  initialCredentialId,
  initialRequiredScopes,
  isLoading,
  onOpenChange,
  open,
  workspaceId,
  organizationId,
}: SlackManagedUsersSetupOptions) {
  const scope = resourceScopeFromOwner({ workspaceId, organizationId })
  const queryClient = useQueryClient()
  const startAuthorization = useStartSlackCredentialGroupConfiguration()
  const [appSetupOpen, setAppSetupOpen] = useState(false)
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [appId, setAppId] = useState('')
  const organizationSetup = scope.kind === 'organization'
  const apps = useSlackSearchInstallations(open && organizationSetup ? organizationId : undefined)
  const availableApps = apps.data?.installations ?? []
  const selectedApp =
    availableApps.find((app) => app.appId === appId) ??
    (availableApps.length === 1 && !appId ? availableApps[0] : undefined)
  const sharedAppInstalled = organizationSetup && selectedApp?.appKind === 'shared'
  const noInstalledApp = organizationSetup && apps.isSuccess && availableApps.length === 0
  /** The shared app connects member accounts without a Search bot installation. */
  const sharedAppWithoutBot = noInstalledApp && Boolean(apps.data?.sharedAppAvailable)
  const previousAppSetup = sharedAppWithoutBot && apps.data?.memberAppKind === 'custom'
  const sharedSetup = sharedAppInstalled || sharedAppWithoutBot
  const searchPolicies = useSearchIntegrations(organizationId ?? '', {
    enabled: open && sharedSetup,
  })
  const searchApproved = searchPolicies.data?.some(
    (policy) => policy.connectorType === 'slack' && policy.approved
  )
  const accounts = useOrganizationAccounts(open && sharedSetup ? organizationId : undefined)
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
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [pending, setPending] = useState(false)
  const [access, setAccess] = useState<'search' | 'workflow' | null>(null)
  const expectedState = useRef<string | null>(null)
  const expectedCredentialId = useRef<string | null>(null)
  const popup = useRef<Window | null>(null)
  const nativeAbort = useRef<AbortController | null>(null)
  const authorizationTimeout = useRef<number | null>(null)

  const defaultCredentialId = initialCredentialId
    ? bots.some((bot) => bot.id === initialCredentialId)
      ? initialCredentialId
      : ''
    : bots.length === 1
      ? bots[0].id
      : ''
  const effectiveCredentialId = selectedCredentialId ?? defaultCredentialId
  const selectedBot = bots.find((bot) => bot.id === effectiveCredentialId)
  const currentScopes = resolveSlackManagedUserScopes(
    initialRequiredScopes ?? SLACK_SEARCH_USER_SCOPES
  )
  const effectiveAccess =
    access ??
    (currentScopes.some(
      (scope) => !SLACK_SEARCH_USER_SCOPES.some((searchScope) => searchScope === scope)
    )
      ? 'workflow'
      : 'search')
  const requiredScopes =
    scope.kind === 'organization'
      ? selectedApp || sharedAppWithoutBot
        ? [...SLACK_SEARCH_USER_SCOPES]
        : []
      : access === null
        ? currentScopes
        : [...(access === 'search' ? SLACK_SEARCH_USER_SCOPES : SLACK_MANAGED_USER_SCOPES)]

  const reset = () => {
    nativeAbort.current?.abort()
    nativeAbort.current = null
    popup.current?.close()
    popup.current = null
    if (authorizationTimeout.current !== null) window.clearTimeout(authorizationTimeout.current)
    authorizationTimeout.current = null
    expectedState.current = null
    expectedCredentialId.current = null
    setAppSetupOpen(false)
    setSelectedCredentialId(null)
    setClientId('')
    setClientSecret('')
    setAppId('')
    setPending(false)
    setAccess(null)
    startAuthorization.reset()
  }

  const handleAuthorizationMessage = (message: SlackManagedUsersMessage) => {
    if (!expectedState.current || message.state !== expectedState.current) return
    const verifiedCredentialId = expectedCredentialId.current
    expectedState.current = null
    expectedCredentialId.current = null
    if (authorizationTimeout.current !== null) window.clearTimeout(authorizationTimeout.current)
    authorizationTimeout.current = null
    popup.current?.close()
    popup.current = null
    setPending(false)
    if (!message.ok) {
      const notification = getSlackManagedUsersFailureNotification(message.reason)
      if (notification.variant === 'warning') toast.warning(notification.message)
      else toast.error(notification.message)
      return
    }
    if (
      message.credentialGroupId !== credentialGroupId ||
      (!organizationSetup &&
        (!verifiedCredentialId || message.slackBotCredentialId !== verifiedCredentialId))
    ) {
      toast.error('Slack app verification failed. Please try again.')
      return
    }
    if (!organizationSetup && !bots.some((bot) => bot.id === verifiedCredentialId)) {
      toast.error('The verified Slack app is no longer available.')
      return
    }
    if (scope.kind === 'organization') {
      void queryClient.invalidateQueries({
        queryKey: organizationAccountsKeys.detail(scope.organizationId),
      })
      void queryClient.invalidateQueries({ queryKey: slackSearchKeys.list(scope.organizationId) })
    } else {
      void queryClient.invalidateQueries({
        queryKey: credentialGroupKeys.workspace(scope.workspaceId),
      })
      void queryClient.invalidateQueries({
        queryKey: credentialGroupKeys.detail(scope.workspaceId, credentialGroupId),
      })
    }
    toast.success('Slack configured')
    onOpenChange(false)
    reset()
  }

  /**
   * Routing the handler through a ref keeps a bots refetch from reopening the
   * channel mid-flow and dropping an already-queued authorization message.
   */
  const messageHandler = useRef(handleAuthorizationMessage)
  useEffect(() => {
    messageHandler.current = handleAuthorizationMessage
  })

  useEffect(() => {
    if (!open || sharedAppReady) return
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isSlackManagedUsersMessage(event.data)) return
      messageHandler.current(event.data)
    }
    return () => channel.close()
  }, [open, sharedAppReady])

  useEffect(() => {
    if (open && sharedAppReady && !appSetupOpen) onOpenChange(false)
  }, [open, sharedAppReady, appSetupOpen, onOpenChange])

  useEffect(
    () => () => {
      nativeAbort.current?.abort()
      if (authorizationTimeout.current !== null) window.clearTimeout(authorizationTimeout.current)
      popup.current?.close()
      popup.current = null
      authorizationTimeout.current = null
      expectedState.current = null
      expectedCredentialId.current = null
    },
    []
  )

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) reset()
  }

  const handleSelectBot = (credentialId: string) => {
    if (pending) return
    setSelectedCredentialId(credentialId)
    setClientId('')
    setClientSecret('')
    startAuthorization.reset()
  }

  const handleSubmit = async () => {
    if (
      pending ||
      (sharedAppInstalled && !sharedAppNeedsUpdate) ||
      (sharedAppWithoutBot && !memberOnlyCanAuthorize) ||
      (!organizationSetup && !selectedBot)
    )
      return
    if (organizationSetup ? !requiredScopes.length : !clientId.trim() || !clientSecret.trim())
      return
    const body = {
      ...(organizationSetup
        ? selectedApp
          ? { appId: selectedApp.appId, teamId: selectedApp.teamId }
          : {}
        : {
            slackBotCredentialId: selectedBot?.id,
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
          }),
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
            owner: resourceScopeFields(scope),
            credentialGroupId,
            body,
          },
          controller.signal
        )
        controller.signal.throwIfAborted()
        if (scope.kind === 'organization')
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: organizationAccountsKeys.detail(scope.organizationId),
            }),
            queryClient.invalidateQueries({
              queryKey: slackSearchKeys.list(scope.organizationId),
            }),
          ])
        else await queryClient.invalidateQueries({ queryKey: credentialGroupKeys.all })
        controller.signal.throwIfAborted()
        toast.success('Slack configured')
        onOpenChange(false)
        reset()
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
        ...resourceScopeFields(scope),
        credentialGroupId,
        body,
      })
      if (popup.current !== opened) return
      expectedState.current = result.state
      expectedCredentialId.current = selectedBot?.id ?? null
      opened.location.href = result.authorizationUrl
      /** COOP can report a live OAuth popup as closed; only the deadline expires its state. */
      authorizationTimeout.current = window.setTimeout(() => {
        if (popup.current !== opened) return
        authorizationTimeout.current = null
        opened.close()
        popup.current = null
        expectedState.current = null
        expectedCredentialId.current = null
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

  const noBots = !organizationSetup && !isLoading && bots.length === 0
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
  const title = organizationSetup ? 'Set up Slack app' : 'Set up Slack'
  const primaryLabel = isLoading
    ? 'Loading...'
    : pending
      ? 'Waiting for Slack...'
      : sharedAppNeedsUpdate || (sharedAppWithoutBot && memberOption)
        ? 'Update member access'
        : 'Verify and add'
  const primaryDisabled =
    isLoading ||
    noBots ||
    (!organizationSetup && !selectedBot) ||
    pending ||
    (organizationSetup
      ? checkingSetup ||
        Boolean(failedSetup) ||
        (sharedAppWithoutBot && !memberOnlyCanAuthorize) ||
        !requiredScopes.length
      : !clientId.trim() || !clientSecret.trim())

  return {
    apps,
    appSetupOpen,
    availableApps,
    checkingSetup,
    clientId,
    clientSecret,
    effectiveAccess,
    effectiveCredentialId,
    failedSetup,
    handleOpenChange,
    handleSelectBot,
    handleSubmit,
    memberAccountsCopy: memberAccountsMessage(
      previousAppSetup,
      memberOption && memberOption.status === 'active'
    ),
    needsApp,
    noBots,
    organizationSetup,
    pending,
    primaryDisabled,
    primaryLabel,
    scope,
    selectedApp,
    selectedBot,
    setAccess,
    setAppId,
    setAppSetupOpen,
    setClientId,
    setClientSecret,
    setSelectedCredentialId,
    sharedAppInstalled,
    sharedAppNeedsUpdate,
    sharedAppReady,
    sharedAppWithoutBot,
    title,
  }
}
