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
} from '@sim/emcn'
import { SlackIcon } from '@/components/icons'
import { SlackAppManifest } from '@/components/integrations/slack-app-manifest'
import { SLACK_SEARCH_SCOPES } from '@/lib/slack-search/constants'
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
  const error = prepare.error ?? oauth.error
  const busy = oauth.isPending
  const stepNumber = step === 'manifest' ? 1 : step === 'credentials' ? 2 : 3
  const configuredAppId = appId ?? prepare.data?.existingApp?.appId

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
          Step {stepNumber} of 4 ·{' '}
          {step === 'manifest'
            ? 'Create the app in Slack'
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
          <>
            <ChipModalField
              type='custom'
              title={installationId ? 'Update your Slack app' : 'Create your Slack app'}
            >
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
              <p className='text-[var(--text-secondary)] text-caption'>
                {configuredAppId
                  ? 'Open App Manifest in your existing app and apply the updated configuration.'
                  : 'Choose your Slack workspace, review the prepared manifest, then create the app.'}
              </p>
            </ChipModalField>
            <ChipModalField type='custom' title='App manifest'>
              <SlackAppManifest manifest={prepare.data.manifest} />
            </ChipModalField>
          </>
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
              <p className='text-[var(--text-muted)] text-caption'>
                {SLACK_SEARCH_SCOPES.join(', ')}
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
