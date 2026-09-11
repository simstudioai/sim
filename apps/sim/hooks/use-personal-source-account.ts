'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { useQueryClient } from '@tanstack/react-query'
import type { PersonalSourceSetupQuery } from '@/lib/api/contracts/knowledge/personal-source-setup'
import {
  CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES,
  credentialGroupOAuthCompletionChannel,
  isCredentialGroupOAuthFailure,
} from '@/lib/credential-groups/oauth-completion'
import {
  personalSourceSetupKeys,
  useAuthorizePersonalSourceSetup,
  usePersonalSourceSetupAccounts,
} from '@/hooks/queries/personal-source-setup'

interface PersonalSourceAccountProps {
  organizationId: string
  connectorType: PersonalSourceSetupQuery['connectorType']
  onConnected?: (credentialId: string) => void
}

/** A popup message only refreshes the account inventory; the server proves completion. */
export function usePersonalSourceAccount({
  organizationId,
  connectorType,
  onConnected,
}: PersonalSourceAccountProps) {
  const [completionId, setCompletionId] = useState<string>()
  const attempt = useRef<{ id: string; tab: Window } | null>(null)
  const accounts = usePersonalSourceSetupAccounts({ organizationId, connectorType, completionId })
  const { mutateAsync: authorize } = useAuthorizePersonalSourceSetup()
  const queryClient = useQueryClient()
  const onConnectedRef = useRef(onConnected)
  const completed = accounts.data?.completedCredentialId
  const { refetch } = accounts

  useEffect(() => {
    onConnectedRef.current = onConnected
  }, [onConnected])

  useEffect(() => {
    return () => {
      attempt.current?.tab.close()
      attempt.current = null
    }
  }, [])

  useEffect(() => {
    if (!completionId || completed) return
    const fail = (message: string) => {
      if (attempt.current?.id !== completionId) return
      attempt.current.tab.close()
      attempt.current = null
      setCompletionId(undefined)
      toast.error(message)
    }
    const channel = new BroadcastChannel(credentialGroupOAuthCompletionChannel(completionId))
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (isCredentialGroupOAuthFailure(data)) fail(CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES[data])
      else if (data === 'connected') void refetch()
    }
    const timer = window.setTimeout(
      () => fail(CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES.expired),
      10 * 60_000
    )
    return () => {
      channel.close()
      window.clearTimeout(timer)
    }
  }, [completionId, completed, refetch])

  useEffect(() => {
    if (completed && attempt.current && attempt.current.id === completionId) {
      attempt.current.tab.close()
      attempt.current = null
      setCompletionId(undefined)
      queryClient.setQueryData(personalSourceSetupKeys.list({ organizationId, connectorType }), {
        ...accounts.data,
        completedCredentialId: null,
      })
      onConnectedRef.current?.(completed)
    }
  }, [completed, completionId, accounts.data, queryClient, organizationId, connectorType])

  const connect = useCallback(async () => {
    if (attempt.current) {
      attempt.current.tab.focus()
      return
    }
    const tab = window.open('about:blank', '_blank', 'width=600,height=700')
    if (!tab) {
      toast.error('Allow pop-ups for this site to connect your account.')
      return
    }
    tab.opener = null
    const id = generateId()
    attempt.current = { id, tab }
    setCompletionId(id)
    try {
      const result = await authorize({
        action: 'authorize',
        organizationId,
        connectorType,
        oauthCompletionId: id,
      })
      if (attempt.current?.id !== id) return
      const url = new URL(result.url)
      if (
        url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && url.origin === window.location.origin)
      ) {
        throw new Error('The provider authorization URL is invalid')
      }
      tab.location.href = url.href
    } catch (error) {
      if (attempt.current?.id !== id) return
      tab.close()
      attempt.current = null
      setCompletionId(undefined)
      toast.error(getErrorMessage(error, 'Could not connect your account'))
    }
  }, [authorize, organizationId, connectorType])

  const cancel = useCallback(() => {
    attempt.current?.tab.close()
    attempt.current = null
    setCompletionId(undefined)
  }, [])

  return { accounts, connect, cancel, pending: Boolean(completionId) }
}
