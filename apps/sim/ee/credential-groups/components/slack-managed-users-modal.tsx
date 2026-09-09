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
import { SlackSearchSetupWizard } from '@/components/integrations/slack-search-setup-wizard'
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
import { useSlackSearchInstallations } from '@/hooks/queries/slack-search'
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
  const organizationSetup = scope.kind === 'organization'
  const apps = useSlackSearchInstallations(open && organizationSetup ? organizationId : undefined)
  const availableApps = apps.data?.installations ?? []
  const selectedApp =
    availableApps.find((app) => app.appId === appId) ??
    (availableApps.length === 1 && !appId ? availableApps[0] : undefined)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [pending, setPending] = useState(false)
  const [access, setAccess] = useState<'search' | 'workflow' | null>(null)
  const expectedState = useRef<string | null>(null)
  const expectedCredentialId = useRef<string | null>(null)
  const popup = useRef<Window | null>(null)
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
      ? selectedApp
        ? [...SLACK_SEARCH_USER_SCOPES]
        : []
      : access === null
        ? currentScopes
        : [...(access === 'search' ? SLACK_SEARCH_USER_SCOPES : SLACK_MANAGED_USER_SCOPES)]

  const reset = () => {
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
    if (pending || (!organizationSetup && !selectedBot)) return
    if (
      organizationSetup
        ? !selectedApp || !requiredScopes.length
        : !clientId.trim() || !clientSecret.trim()
    )
      return

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
            ? { appId: selectedApp?.appId, teamId: selectedApp?.teamId }
            : {
                slackBotCredentialId: selectedBot?.id,
                clientId: clientId.trim(),
                clientSecret: clientSecret.trim(),
              }),
          requiredScopes,
        },
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
  const needsApp = organizationSetup && apps.isSuccess && availableApps.length === 0
  const title = organizationSetup ? 'Connect Slack accounts' : 'Set up Slack'
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
    (organizationSetup
      ? apps.isPending || Boolean(apps.error) || !selectedApp || !requiredScopes.length
      : !clientId.trim() || !clientSecret.trim())

  return (
    <>
      <ChipModal
        open={open && !appSetupOpen}
        onOpenChange={handleOpenChange}
        srTitle={title}
        size='md'
      >
        <ChipModalHeader icon={SlackIcon} onClose={() => handleOpenChange(false)}>
          {title}
        </ChipModalHeader>
        <ChipModalBody>
          {organizationSetup ? (
            apps.isPending ? (
              <ChipModalField type='custom' title='Sim Search app'>
                <p role='status' className='text-[var(--text-secondary)] text-sm'>
                  Checking the installed Slack app…
                </p>
              </ChipModalField>
            ) : apps.error ? (
              <ChipModalField type='custom' title='Sim Search app' error={apps.error.message}>
                <Chip onClick={() => void apps.refetch()} disabled={apps.isFetching}>
                  Retry
                </Chip>
              </ChipModalField>
            ) : needsApp ? (
              <ChipModalField type='custom' title='Install Sim Search first'>
                <p className='text-[var(--text-secondary)] text-sm'>
                  Install the Sim Search app in your Slack workspace to use the bot and connect
                  Slack sources. Members can then authorize their own accounts for indexing.
                </p>
              </ChipModalField>
            ) : (
              <>
                {availableApps.length > 1 ? (
                  <ChipModalField
                    type='dropdown'
                    title='Sim Search app'
                    value={selectedApp?.appId}
                    onChange={setAppId}
                    disabled={pending}
                    options={availableApps.map((app) => ({
                      value: app.appId,
                      label: app.teamName,
                      icon: SlackIcon,
                    }))}
                    placeholder='Select the Slack workspace'
                    required
                  />
                ) : (
                  <ChipModalField type='custom' title='Sim Search app'>
                    <p className='text-[var(--text-body)] text-sm'>
                      Installed in {selectedApp?.teamName}
                    </p>
                  </ChipModalField>
                )}
                <ChipModalField type='custom' title='Member accounts'>
                  <p className='text-[var(--text-secondary)] text-sm'>
                    Verify member authorization for the installed app. Each member can then connect
                    their Slack account to index channels and DMs they can access.
                  </p>
                  {selectedApp && (
                    <Chip onClick={() => setAppSetupOpen(true)} disabled={pending}>
                      Manage Sim Search app
                    </Chip>
                  )}
                </ChipModalField>
              </>
            )
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
          {...(needsApp
            ? {
                primaryAction: {
                  label: 'Install Sim Search',
                  onClick: () => setAppSetupOpen(true),
                },
              }
            : noBots
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
      {open &&
        appSetupOpen &&
        (scope.kind === 'organization' ? (
          <SlackSearchSetupWizard
            organizationId={scope.organizationId}
            installationId={selectedApp?.id}
            appId={selectedApp?.appId}
            initialName={
              apps.data?.bots.find((bot) => bot.id === selectedApp?.credentialId)?.displayName
            }
            onClose={() => setAppSetupOpen(false)}
          />
        ) : (
          <ConnectSlackBotModal
            open
            onOpenChange={setAppSetupOpen}
            workspaceId={scope.workspaceId}
            onCreated={setSelectedCredentialId}
          />
        ))}
    </>
  )
}
