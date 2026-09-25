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
} from '@sim/emcn'
import { SlackIcon } from '@/components/icons'
import { SlackAppManifest } from '@/components/integrations/slack-app-manifest'
import {
  SLACK_SEARCH_DEFAULT_DESCRIPTION,
  SLACK_SEARCH_DEFAULT_NAME,
} from '@/lib/slack-search/manifest'
import {
  useConnectCustomSlackSearch,
  useSlackSearchManifest,
  useStartSlackSearchOAuth,
} from '@/hooks/queries/slack-search'

interface SlackSearchSetupWizardProps {
  organizationId: string
  mode?: 'custom' | 'shared'
  installationId?: string
  appId?: string
  initialName?: string
  onClose: () => void
}

/** App creation, credentials, and consent are one organization-specific setup flow. */
export function SlackSearchSetupWizard({
  organizationId,
  mode,
  installationId,
  appId,
  initialName,
  onClose,
}: SlackSearchSetupWizardProps) {
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
      setStep('token')
    } else if (step === 'token') {
      setStep('credentials')
    } else {
      connect.mutate(
        {
          organizationId,
          installationId,
          name,
          description,
          botToken: botToken.trim(),
          ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
          ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
          ...(signingSecret.trim() ? { signingSecret: signingSecret.trim() } : {}),
        },
        {
          onSuccess: onClose,
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
        srTitle='Install the Sim Search app'
        size='sm'
      >
        <ChipModalHeader icon={SlackIcon} onClose={onClose}>
          Install the Sim Search app
        </ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            Add Sim Search to your Slack workspace to ask questions and get answers from your
            connected sources.
          </p>
          <ChipModalError>
            {error?.message ??
              (!prepare.data.sharedAppId
                ? 'Sim Search installation is unavailable. Try again.'
                : null)}
          </ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={onClose}
          secondaryActions={
            prepare.error || !prepare.data.sharedAppId
              ? [
                  {
                    label: 'Retry',
                    onClick: () => void prepare.refetch(),
                    disabled: prepare.isFetching,
                  },
                ]
              : undefined
          }
          primaryAction={{
            label: busy ? 'Connecting…' : 'Continue with Slack',
            disabled: busy || !prepare.data.sharedAppId || Boolean(prepare.error),
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
        : 'Install Slack app'

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
          <ChipModalField type='custom' title='App manifest'>
            <SlackAppManifest
              manifest={prepare.data.manifest}
              createAppUrl={configuredAppId ? undefined : prepare.data.createAppUrl}
              disabled={Boolean(prepare.error)}
            />
            <p className='text-[var(--text-secondary)] text-sm'>
              {configuredAppId
                ? 'In your Slack app, open App Manifest, replace the JSON, and save changes.'
                : 'Create Slack app opens Slack with this manifest already filled in. Select your workspace, review the configuration, and click Create.'}
            </p>
            {configuredAppId && (
              <ChipLink
                className='w-fit'
                href={`https://api.slack.com/apps/${encodeURIComponent(configuredAppId)}`}
                target='_blank'
                rel='noopener noreferrer'
              >
                Open app settings
              </ChipLink>
            )}
          </ChipModalField>
        )}
        {step === 'credentials' && (
          <>
            <p className='px-2 text-[var(--text-secondary)] text-sm'>
              Open Basic Information → App Credentials in the same Slack app. Copy these values,
              then connect the app to Sim.
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
        {step === 'token' && (
          <>
            <p className='px-2 text-[var(--text-secondary)] text-sm'>
              Open OAuth &amp; Permissions in Slack, choose Install to Workspace (or Reinstall to
              Workspace), and approve access. Then copy the Bot User OAuth Token below.
            </p>
            <ChipModalField
              type='input'
              title='Bot User OAuth Token'
              value={botToken}
              onChange={setBotToken}
              inputType='password'
              placeholder='xoxb-...'
              required
            />
          </>
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
                  connect.reset()
                  setStep(step === 'credentials' ? 'token' : 'manifest')
                },
              }
        }
        primaryAction={{
          label: busy ? 'Connecting…' : step === 'credentials' ? 'Connect app' : 'Continue',
          onClick: advance,
          disabled:
            busy ||
            Boolean(prepare.error) ||
            (step === 'token' && !botToken.trim()) ||
            (step === 'credentials' &&
              !installationId &&
              (!clientId.trim() || !clientSecret.trim() || !signingSecret.trim())),
        }}
      />
    </ChipModal>
  )
}
