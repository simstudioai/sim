'use client'

import { useState } from 'react'
import {
  Chip,
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
  const stepNumber = step === 'manifest' ? 1 : step === 'credentials' ? 2 : 3
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

  return (
    <ChipModal
      open
      dismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      srTitle='Set up Sim Search in Slack'
      size='lg'
    >
      <ChipModalHeader icon={SlackIcon} onClose={onClose}>
        {installationId ? 'Reconnect Slack Search' : 'Set up Sim Search in Slack'}
      </ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-muted)] text-caption'>
          Step {stepNumber} of 3 ·{' '}
          {step === 'manifest'
            ? configuredAppId
              ? 'Update your Slack app'
              : 'Create your Slack app'
            : step === 'credentials'
              ? 'App credentials'
              : 'Install in Slack'}
        </p>
        {step === 'manifest' && prepare.isPending && (
          <p role='status' className='px-2 text-[var(--text-muted)] text-sm'>
            Preparing your Slack app…
          </p>
        )}
        {step === 'manifest' && prepare.data && (
          <ChipModalField
            type='custom'
            title={configuredAppId ? 'Update your Slack app' : 'Create your Slack app'}
            hint={
              configuredAppId
                ? configurationCopied
                  ? 'Configuration copied. In Slack, open App Manifest, select JSON, replace the configuration, and save your changes before continuing.'
                  : 'Copy the updated configuration, then open your app in Slack to apply it.'
                : undefined
            }
          >
            {configuredAppId && !configurationCopied ? (
              <Chip onClick={() => void copyConfiguration()}>Copy app configuration</Chip>
            ) : (
              <ChipLink
                href={
                  configuredAppId
                    ? `https://api.slack.com/apps/${encodeURIComponent(configuredAppId)}`
                    : prepare.data.createAppUrl
                }
                target='_blank'
                rel='noopener noreferrer'
              >
                {configuredAppId ? 'Open Slack app settings' : 'Create app in Slack'}
              </ChipLink>
            )}
          </ChipModalField>
        )}
        {step === 'credentials' && (
          <>
            <p className='px-2 text-[var(--text-secondary)] text-sm'>
              In your Slack app, open <strong>Basic Information</strong> and copy these three
              values.{' '}
              {installationId ? 'Leave fields blank to keep the saved app credentials.' : ''}
            </p>
            <ChipModalField
              type='input'
              title='Client ID'
              value={clientId}
              onChange={setClientId}
              required={!installationId}
            />
            <ChipModalField
              type='input'
              title='Client Secret'
              value={clientSecret}
              onChange={setClientSecret}
              inputType='password'
              required={!installationId}
            />
            <ChipModalField
              type='input'
              title='Signing Secret'
              value={signingSecret}
              onChange={setSigningSecret}
              inputType='password'
              required={!installationId}
            />
          </>
        )}
        {step === 'install' && (
          <>
            <ChipModalField type='custom' title='Authorize the bot'>
              <p className='text-[var(--text-secondary)] text-sm'>
                Slack will ask you to install {name}. We’ll validate the connection and enable
                Search when you return.
              </p>
              <p className='text-[var(--text-muted)] text-caption'>
                The bot responds to direct messages and channel mentions and reads members’ email
                addresses. Each member separately authorizes indexing through this same app.
              </p>
            </ChipModalField>
          </>
        )}
        {error && <ChipModalError>{error.message}</ChipModalError>}
        {prepare.error && (
          <div className='px-2'>
            <Chip onClick={() => void prepare.refetch()} disabled={prepare.isFetching}>
              Retry
            </Chip>
          </div>
        )}
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
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
          label: busy ? 'Connecting…' : step === 'install' ? 'Install in Slack' : 'Continue',
          onClick: advance,
          disabled:
            busy ||
            (step === 'manifest'
              ? !prepare.data
              : !installationId &&
                (!clientId.trim() || !clientSecret.trim() || !signingSecret.trim())),
        }}
      />
    </ChipModal>
  )
}
