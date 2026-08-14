'use client'

import { useEffect, useRef, useState } from 'react'
import {
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
import { useStartSlackCredentialGroupConfiguration } from '@/hooks/queries/credential-groups'
import { credentialGroupKeys } from '@/hooks/queries/utils/credential-group-queries'

const CHANNEL_NAME = 'slack-managed-users'
const AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1000

interface SlackManagedUsersModalProps {
  bots: WorkspaceCredential[]
  credentialGroupId: string
  error: Error | null
  initialCredentialId?: string
  isLoading: boolean
  onOpenChange: (open: boolean) => void
  open: boolean
  workspaceId: string
}

interface SlackManagedUsersMessage {
  type: typeof CHANNEL_NAME
  ok: boolean
  state?: string
  credentialGroupId?: string
  slackBotCredentialId?: string
}

function isSlackManagedUsersMessage(value: unknown): value is SlackManagedUsersMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return (
    message.type === CHANNEL_NAME &&
    typeof message.ok === 'boolean' &&
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
  isLoading,
  onOpenChange,
  open,
  workspaceId,
}: SlackManagedUsersModalProps) {
  const queryClient = useQueryClient()
  const startAuthorization = useStartSlackCredentialGroupConfiguration()
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [pending, setPending] = useState(false)
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

  useEffect(() => {
    if (!open) return
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isSlackManagedUsersMessage(event.data)) return
      if (!expectedState.current || event.data.state !== expectedState.current) return
      const verifiedCredentialId = expectedCredentialId.current
      expectedState.current = null
      expectedCredentialId.current = null
      if (popupWatcher.current !== null) window.clearInterval(popupWatcher.current)
      popupWatcher.current = null
      popup.current?.close()
      popup.current = null
      setPending(false)
      if (
        !event.data.ok ||
        event.data.credentialGroupId !== credentialGroupId ||
        !verifiedCredentialId ||
        event.data.slackBotCredentialId !== verifiedCredentialId
      ) {
        toast.error('Slack app verification failed. Please try again.')
        return
      }
      if (!bots.some((bot) => bot.id === verifiedCredentialId)) {
        toast.error('The verified Slack app is no longer available.')
        return
      }
      void queryClient.invalidateQueries({
        queryKey: credentialGroupKeys.list(workspaceId),
      })
      void queryClient.invalidateQueries({
        queryKey: credentialGroupKeys.detail(workspaceId, credentialGroupId),
      })
      toast.success('Slack configured')
      onOpenChange(false)
      reset()
    }
    return () => channel.close()
  }, [bots, credentialGroupId, onOpenChange, open, queryClient, workspaceId])

  useEffect(
    () => () => {
      if (popupWatcher.current !== null) window.clearInterval(popupWatcher.current)
      popup.current?.close()
    },
    []
  )

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
    setPending(false)
    startAuthorization.reset()
  }

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
    if (!selectedBot || pending) return
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
        workspaceId,
        credentialGroupId,
        body: {
          slackBotCredentialId: selectedBot.id,
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
        },
      })
      expectedState.current = result.state
      expectedCredentialId.current = selectedBot.id
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

  const noBots = !isLoading && bots.length === 0
  const primaryLabel = isLoading
    ? 'Loading...'
    : noBots
      ? 'Add Slack'
      : pending
        ? 'Waiting for Slack...'
        : 'Verify and add'
  const primaryDisabled =
    isLoading || noBots || !selectedBot || pending || !clientId.trim() || !clientSecret.trim()

  return (
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
        {isLoading ? (
          <div className='flex flex-col gap-3 px-2 py-1'>
            <Skeleton className='h-4 w-24 rounded' />
            <Skeleton className='h-9 w-full rounded-lg' />
          </div>
        ) : noBots ? (
          <p className='px-2 py-4 text-center text-[var(--text-muted)] text-sm'>
            Add a custom Slack app from Integrations before adding Slack to this group.
          </p>
        ) : (
          <>
            <ChipModalField
              type='dropdown'
              title='Custom bot'
              value={effectiveCredentialId || undefined}
              onChange={handleSelectBot}
              options={bots.map((bot) => ({
                value: bot.id,
                label: bot.displayName,
                icon: SlackIcon,
              }))}
              placeholder='Select a custom bot'
              disabled={pending}
              required
            />
            {selectedBot ? (
              <>
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
        primaryAction={{
          label: primaryLabel,
          onClick: () => void handleSubmit(),
          disabled: primaryDisabled,
        }}
      />
    </ChipModal>
  )
}
