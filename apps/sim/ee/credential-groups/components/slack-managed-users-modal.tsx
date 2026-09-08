'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Skeleton,
  toast,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { SlackIcon } from '@/components/icons'
import type { WorkspaceCredential } from '@/lib/api/contracts'
import type { OrganizationCredential } from '@/lib/api/contracts/organization-credentials'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import {
  resolveSlackManagedUserScopes,
  SLACK_MANAGED_USER_SCOPES,
  SLACK_SEARCH_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'
import { ConnectSlackBotModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-slack-bot-modal/connect-slack-bot-modal'
import { useStartSlackCredentialGroupConfiguration } from '@/hooks/queries/credential-groups'
import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'
import { credentialGroupKeys } from '@/hooks/queries/utils/credential-group-queries'

const CHANNEL_NAME = 'slack-managed-users'
const AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1000

interface SlackManagedUsersModalProps {
  bots: Array<WorkspaceCredential | OrganizationCredential>
  credentialGroupId: string
  error: Error | null
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

export function getSlackManagedUsersFailureNotification(reason?: string): {
  message: string
  variant: 'error' | 'warning'
} {
  return reason === 'provider_error'
    ? { message: 'Slack authorization canceled', variant: 'warning' }
    : { message: 'Slack app verification failed. Please try again.', variant: 'error' }
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

export function SlackManagedUsersModal({
  bots,
  credentialGroupId,
  error,
  initialCredentialId,
  initialRequiredScopes,
  isLoading,
  onOpenChange,
  open,
  workspaceId,
  organizationId,
}: SlackManagedUsersModalProps) {
  const scope = resourceScopeFromOwner({ workspaceId, organizationId })
  const queryClient = useQueryClient()
  const startAuthorization = useStartSlackCredentialGroupConfiguration()
  const [appSetupOpen, setAppSetupOpen] = useState(false)
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [appId, setAppId] = useState('')
  const [teamId, setTeamId] = useState('')
  const organizationSetup = scope.kind === 'organization'
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [pending, setPending] = useState(false)
  const [access, setAccess] = useState<'search' | 'workflow' | null>(null)
  const expectedState = useRef<string | null>(null)
  const expectedCredentialId = useRef<string | null>(null)
  const popup = useRef<Window | null>(null)
  const popupWatcher = useRef<number | null>(null)

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
      ? [...SLACK_MANAGED_USER_SCOPES]
      : access === null
        ? currentScopes
        : [...(access === 'search' ? SLACK_SEARCH_USER_SCOPES : SLACK_MANAGED_USER_SCOPES)]

  const reset = () => {
    popup.current?.close()
    popup.current = null
    if (popupWatcher.current !== null) window.clearInterval(popupWatcher.current)
    popupWatcher.current = null
    expectedState.current = null
    expectedCredentialId.current = null
    setSelectedCredentialId(null)
    setClientId('')
    setClientSecret('')
    setAppId('')
    setTeamId('')
    setPending(false)
    setAccess(null)
    startAuthorization.reset()
  }

  const handleAuthorizationMessage = (message: SlackManagedUsersMessage) => {
    if (!expectedState.current || message.state !== expectedState.current) return
    const verifiedCredentialId = expectedCredentialId.current
    expectedState.current = null
    expectedCredentialId.current = null
    if (popupWatcher.current !== null) window.clearInterval(popupWatcher.current)
    popupWatcher.current = null
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
   * The subscription's identity is `open` alone. Routing the handler through a
   * ref keeps a `bots` refetch from closing and reopening the channel mid-flow,
   * which would drop an already-queued authorization message from the popup.
   */
  const messageHandler = useRef(handleAuthorizationMessage)
  useEffect(() => {
    messageHandler.current = handleAuthorizationMessage
  })

  useEffect(() => {
    if (!open) return
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isSlackManagedUsersMessage(event.data)) return
      messageHandler.current(event.data)
    }
    return () => channel.close()
  }, [open])

  useEffect(
    () => () => {
      if (popupWatcher.current !== null) window.clearInterval(popupWatcher.current)
      popup.current?.close()
    },
    []
  )

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending && !nextOpen) return
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
    if (pending || (!organizationSetup && !selectedBot)) return
    if (organizationSetup && (!appId.trim() || !teamId.trim())) return
    if (!clientId.trim() || !clientSecret.trim()) return

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
        body: {
          ...(organizationSetup
            ? { appId: appId.trim(), teamId: teamId.trim() }
            : { slackBotCredentialId: selectedBot?.id }),
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          requiredScopes,
        },
      })
      expectedState.current = result.state
      expectedCredentialId.current = selectedBot?.id ?? null
      opened.location.href = result.authorizationUrl
      const startedAt = Date.now()
      popupWatcher.current = window.setInterval(() => {
        if (!opened.closed && Date.now() - startedAt < AUTHORIZATION_TIMEOUT_MS) return
        window.clearInterval(popupWatcher.current ?? undefined)
        popupWatcher.current = null
        opened.close()
        popup.current = null
        expectedState.current = null
        expectedCredentialId.current = null
        setPending(false)
        toast.error('Slack authorization expired. Please try again.')
      }, 500)
    } catch (authorizationError) {
      opened.close()
      popup.current = null
      setPending(false)
      toast.error(getErrorMessage(authorizationError, 'Could not start Slack authorization'))
    }
  }

  const noBots = !organizationSetup && !isLoading && bots.length === 0
  const primaryLabel = isLoading
    ? 'Loading...'
    : pending
      ? 'Waiting for Slack...'
      : 'Verify and add'
  const primaryDisabled =
    isLoading ||
    noBots ||
    (!organizationSetup && !selectedBot) ||
    pending ||
    !clientId.trim() ||
    !clientSecret.trim() ||
    (organizationSetup && (!appId.trim() || !teamId.trim()))

  return (
    <>
      <ChipModal
        open={open}
        onOpenChange={handleOpenChange}
        dismissDisabled={pending}
        srTitle='Set up Slack'
        size='md'
      >
        <ChipModalHeader
          icon={SlackIcon}
          onClose={() => handleOpenChange(false)}
          closeDisabled={pending}
        >
          Set up Slack
        </ChipModalHeader>
        <ChipModalBody>
          {organizationSetup ? (
            <>
              <ChipModalField
                type='input'
                title='Slack App ID'
                value={appId}
                onChange={setAppId}
                placeholder='A…'
                required
                disabled={pending}
                hint='The app used for personal account authorization. Workspace bots are configured separately.'
              />
              <ChipModalField
                type='input'
                title='Slack workspace ID'
                value={teamId}
                onChange={setTeamId}
                placeholder='T…'
                required
                disabled={pending}
              />
              <ChipModalField
                type='input'
                title='Client ID'
                value={clientId}
                onChange={setClientId}
                required
                disabled={pending}
                autoComplete='off'
              />
              <ChipModalField
                type='input'
                inputType='password'
                title='Client Secret'
                value={clientSecret}
                onChange={setClientSecret}
                required
                disabled={pending}
                autoComplete='off'
                hint='Use the personal user scopes required for workflow tools. Disable Slack token rotation for this app.'
              />
            </>
          ) : isLoading ? (
            <div className='flex flex-col gap-[9px] px-2'>
              <Skeleton className='h-4 w-24 rounded' />
              <Skeleton className='h-[30px] w-full rounded-lg' />
            </div>
          ) : noBots ? (
            <ChipModalField
              type='custom'
              title='Slack app'
              hint='Set up a Slack app so members can connect their accounts.'
            >
              <Chip onClick={() => setAppSetupOpen(true)}>Set up Slack app</Chip>
            </ChipModalField>
          ) : (
            <>
              <ChipModalField
                type='dropdown'
                title='Slack app'
                value={effectiveCredentialId || undefined}
                onChange={handleSelectBot}
                options={bots.map((bot) => ({
                  value: bot.id,
                  label: bot.displayName,
                  icon: SlackIcon,
                }))}
                placeholder='Select a Slack app'
                disabled={pending}
                required
              />
              {selectedBot ? (
                <>
                  {scope.kind === 'workspace' && (
                    <ChipModalField
                      type='dropdown'
                      title='Access'
                      value={effectiveAccess}
                      onChange={(value) => {
                        if (value === 'search' || value === 'workflow') setAccess(value)
                      }}
                      options={[
                        { value: 'search', label: 'Search documents' },
                        { value: 'workflow', label: 'Workflow tools' },
                      ]}
                      hint={
                        effectiveAccess === 'search'
                          ? 'Read messages members can access. Changing access requires members to reconnect.'
                          : 'Read and write Slack content for workflows. Changing access requires members to reconnect.'
                      }
                      disabled={pending}
                    />
                  )}
                  <ChipModalField
                    type='input'
                    title='Client ID'
                    value={clientId}
                    onChange={setClientId}
                    placeholder='Paste the Client ID'
                    autoComplete='off'
                    disabled={pending}
                    required
                  />
                  <ChipModalField
                    type='input'
                    inputType='password'
                    title='Client Secret'
                    value={clientSecret}
                    onChange={setClientSecret}
                    placeholder='Paste the Client Secret'
                    autoComplete='off'
                    disabled={pending}
                    required
                  />
                </>
              ) : null}
            </>
          )}
          <ChipModalError>{error ? getErrorMessage(error) : null}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => handleOpenChange(false)}
          cancelDisabled={pending}
          {...(noBots
            ? { defaultAction: 'dismiss' as const }
            : {
                primaryAction: {
                  label: primaryLabel,
                  onClick: () => void handleSubmit(),
                  disabled: primaryDisabled,
                },
              })}
        />
      </ChipModal>
      {appSetupOpen && (
        <ConnectSlackBotModal
          open
          onOpenChange={setAppSetupOpen}
          {...resourceScopeFields(scope)}
          onCreated={setSelectedCredentialId}
        />
      )}
    </>
  )
}
