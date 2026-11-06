'use client'

import { useEffect, useRef, useState } from 'react'
import { isDesktopApp } from '@/lib/desktop'
import {
  SLACK_SEARCH_DEFAULT_DESCRIPTION,
  SLACK_SEARCH_DEFAULT_NAME,
} from '@/lib/slack-search/manifest'
import {
  useConnectCustomSlackSearch,
  useSlackSearchManifest,
  useStartSlackSearchOAuth,
} from '@/hooks/queries/slack-search'

export interface SlackSearchSetupOptions {
  organizationId: string
  mode?: 'custom' | 'shared'
  installationId?: string
  appId?: string
  initialName?: string
  onClose: () => void
}

/** App creation, credentials, and consent are one organization-specific setup flow. */
export function useSlackSearchSetup({
  organizationId,
  mode,
  installationId,
  appId,
  initialName,
  onClose,
}: SlackSearchSetupOptions) {
  const nativeAbort = useRef<AbortController | null>(null)
  useEffect(() => () => nativeAbort.current?.abort(), [])
  const close = () => {
    nativeAbort.current?.abort()
    onClose()
  }
  const name = initialName ?? SLACK_SEARCH_DEFAULT_NAME
  const description = SLACK_SEARCH_DEFAULT_DESCRIPTION
  const prepare = useSlackSearchManifest(organizationId, name)
  const oauth = useStartSlackSearchOAuth()
  const connect = useConnectCustomSlackSearch()
  const [step, setStep] = useState<'manifest' | 'credentials' | 'token'>('manifest')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [botToken, setBotToken] = useState('')
  const error = prepare.error ?? oauth.error ?? connect.error
  const busy = oauth.isPending || connect.isPending
  const configuredAppId = appId ?? prepare.data?.existingApp?.appId

  const shared = mode
    ? mode === 'shared'
    : Boolean(
        prepare.data?.sharedAppId &&
          (!configuredAppId || configuredAppId === prepare.data.sharedAppId)
      )

  /**
   * Settles with the start of consent, for a dialog to hold on. On desktop consent runs in the
   * user's browser and they may close the dialog meanwhile, so there is nothing to hold on.
   */
  function installShared() {
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
      .then(
        (result) => {
          if (result) window.location.assign(result.authorizationUrl)
          else onClose()
        },
        () => undefined
      )
    return isDesktopApp() ? undefined : started
  }

  /** A step forward is immediate; the last one settles with the connection, for a dialog to hold on. */
  async function advance() {
    if (step === 'manifest') {
      setStep('token')
    } else if (step === 'token') {
      setStep('credentials')
    } else {
      try {
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
      } catch {
        return
      }
      onClose()
    }
  }

  const title =
    step === 'manifest'
      ? configuredAppId
        ? 'Update Slack app'
        : 'Create Slack app'
      : step === 'credentials'
        ? 'Slack app credentials'
        : 'Install Slack app'
  const continueDisabled =
    busy ||
    Boolean(prepare.error) ||
    (step === 'token' && !botToken.trim()) ||
    (step === 'credentials' &&
      !installationId &&
      (!clientId.trim() || !clientSecret.trim() || !signingSecret.trim()))
  return {
    /** A running connect, or a browser OAuth start, finishes before its dialog can be dismissed. */
    dismissBlocked: connect.isPending || (oauth.isPending && !isDesktopApp()),
    advance,
    botToken,
    busy,
    clientId,
    clientSecret,
    close,
    configuredAppId,
    connect,
    continueDisabled,
    error,
    installShared,
    oauth,
    prepare,
    setBotToken,
    setClientId,
    setClientSecret,
    setSigningSecret,
    setStep,
    shared,
    signingSecret,
    step,
    title,
  }
}
