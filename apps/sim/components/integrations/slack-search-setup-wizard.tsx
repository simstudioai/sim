'use client'

import { useState } from 'react'
import {
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  writeTextToClipboard,
} from '@sim/emcn'
import { SlackIcon } from '@/components/icons'
import {
  SLACK_SEARCH_DEFAULT_DESCRIPTION,
  SLACK_SEARCH_DEFAULT_NAME,
} from '@/lib/slack-search/manifest'
import { useSlackSearchManifest, useStartSlackSearchOAuth } from '@/hooks/queries/slack-search'

interface SlackSearchSetupWizardProps {
  organizationId: string
  installationId?: string
  appId?: string
  initialName?: string
  onClose: () => void
}

/** App creation, credentials, and consent are one organization-specific setup flow. */
export function SlackSearchSetupWizard({
  organizationId,
  installationId,
  appId,
  initialName,
  onClose,
}: SlackSearchSetupWizardProps) {
  const name = initialName ?? SLACK_SEARCH_DEFAULT_NAME
  const description = SLACK_SEARCH_DEFAULT_DESCRIPTION
  const prepare = useSlackSearchManifest(organizationId, name)
  const oauth = useStartSlackSearchOAuth()
  const [step, setStep] = useState<'manifest' | 'credentials' | 'install'>('manifest')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [configurationCopied, setConfigurationCopied] = useState(false)
  const [copyError, setCopyError] = useState<Error | null>(null)
  const error = prepare.error ?? oauth.error ?? copyError
  const busy = oauth.isPending
  const configuredAppId = appId ?? prepare.data?.existingApp?.appId

  async function copyConfiguration() {
    if (!prepare.data) throw new Error('Slack app configuration is not ready')
    setCopyError(null)
    try {
      await writeTextToClipboard(prepare.data.manifest)
      setConfigurationCopied(true)
    } catch {
      setCopyError(
        new Error('Could not copy the app configuration. Allow clipboard access and try again.')
      )
    }
  }

  const shared = Boolean(
    prepare.data?.sharedAppId && (!configuredAppId || configuredAppId === prepare.data.sharedAppId)
  )

  function installShared() {
    oauth.mutate(
      { organizationId, installationId, name, description, mode: 'shared' },
      {
        onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
      }
    )
  }

  function advance() {
    if (step === 'manifest') {
      setStep('credentials')
    } else if (step === 'credentials') {
      setStep('install')
    } else {
      oauth.mutate(
        {
          organizationId,
          installationId,
          name,
          description,
          ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
          ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
          ...(signingSecret.trim() ? { signingSecret: signingSecret.trim() } : {}),
        },
        {
          onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
        }
      )
    }
  }

  if (!prepare.data)
    return (
      <ChipModal
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        srTitle='Sim Search in Slack'
      >
        <ChipModalHeader icon={SlackIcon} onClose={onClose}>
          Sim Search in Slack
        </ChipModalHeader>
        <ChipModalBody>
          {prepare.error ? (
            <ChipModalError>{prepare.error.message}</ChipModalError>
          ) : (
            <p role='status' className='px-2 text-[var(--text-secondary)] text-sm'>
              Loading Slack setup…
            </p>
          )}
        </ChipModalBody>
        <ChipModalFooter
          onCancel={onClose}
          defaultAction='dismiss'
          secondaryActions={
            prepare.error
              ? [
                  {
                    label: 'Retry',
                    onClick: () => void prepare.refetch(),
                    disabled: prepare.isFetching,
                  },
                ]
              : undefined
          }
        />
      </ChipModal>
    )

  if (shared)
    return (
      <ChipModal
        open
        dismissDisabled={busy}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        srTitle='Install Sim Search'
      >
        <ChipModalHeader icon={SlackIcon} onClose={onClose}>
          Install Sim Search
        </ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            Choose your Slack workspace and approve Sim Search.
          </p>
          <ChipModalError>{error?.message}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={onClose}
          primaryAction={{
            label: busy ? 'Connecting…' : 'Install Sim Search',
            disabled: busy,
            onClick: installShared,
          }}
        />
      </ChipModal>
    )

  const title =
    step === 'manifest'
      ? configuredAppId
        ? 'Update Slack app'
        : 'Create Slack app'
      : step === 'credentials'
        ? 'Slack app credentials'
        : installationId
          ? 'Reconnect in Slack'
          : 'Install in Slack'

  return (
    <ChipModal
      open
      dismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      srTitle={title}
      size='md'
    >
      <ChipModalHeader icon={SlackIcon} onClose={onClose}>
        {title}
      </ChipModalHeader>
      <ChipModalBody>
        {step === 'manifest' && (
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            {configuredAppId
              ? configurationCopied
                ? 'Configuration copied. In Slack, replace the JSON under App Manifest and save.'
                : 'Copy the configuration, then replace the JSON under App Manifest in Slack.'
              : 'Create the app in Slack, then return here to add its credentials.'}
          </p>
        )}
        {step === 'credentials' && (
          <>
            <p className='px-2 text-[var(--text-secondary)] text-sm'>
              Find these values under Basic Information in your Slack app.
            </p>
            <ChipModalField
              type='input'
              title='Client ID'
              value={clientId}
              onChange={setClientId}
              placeholder={
                installationId
                  ? 'Leave blank to keep the saved value'
                  : 'Paste your Slack app’s client ID'
              }
              required={!installationId}
            />
            <ChipModalField
              type='input'
              title='Client Secret'
              value={clientSecret}
              onChange={setClientSecret}
              inputType='password'
              placeholder={
                installationId
                  ? 'Leave blank to keep the saved value'
                  : 'Paste your Slack app’s client secret'
              }
              required={!installationId}
            />
            <ChipModalField
              type='input'
              title='Signing Secret'
              value={signingSecret}
              onChange={setSigningSecret}
              inputType='password'
              placeholder={
                installationId
                  ? 'Leave blank to keep the saved value'
                  : 'Paste your Slack app’s signing secret'
              }
              required={!installationId}
            />
          </>
        )}
        {step === 'install' && (
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            {installationId
              ? 'Approve the updated permissions for'
              : 'Choose your workspace and approve'}{' '}
            {name} in Slack.
          </p>
        )}
        <ChipModalError>{error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        secondaryActions={
          prepare.error
            ? [
                {
                  label: 'Retry',
                  onClick: () => void prepare.refetch(),
                  disabled: prepare.isFetching,
                },
              ]
            : step === 'manifest'
              ? configuredAppId && !configurationCopied
                ? [{ label: 'Copy configuration', onClick: () => void copyConfiguration() }]
                : [
                    {
                      custom: (
                        <ChipLink
                          href={
                            configuredAppId
                              ? `https://api.slack.com/apps/${encodeURIComponent(configuredAppId)}`
                              : prepare.data.createAppUrl
                          }
                          target='_blank'
                          rel='noopener noreferrer'
                        >
                          {configuredAppId ? 'Open app settings' : 'Create app'}
                        </ChipLink>
                      ),
                    },
                  ]
              : undefined
        }
        primaryAdjacentAction={
          step === 'manifest'
            ? undefined
            : {
                label: 'Back',
                disabled: busy,
                onClick: () => {
                  oauth.reset()
                  setStep(step === 'install' ? 'credentials' : 'manifest')
                },
              }
        }
        primaryAction={{
          label: busy ? 'Connecting…' : step === 'install' ? title : 'Continue',
          onClick: advance,
          disabled:
            busy ||
            (step === 'manifest'
              ? Boolean(configuredAppId && !configurationCopied)
              : !installationId &&
                (!clientId.trim() || !clientSecret.trim() || !signingSecret.trim())),
        }}
      />
    </ChipModal>
  )
}
