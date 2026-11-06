'use client'

import { useState } from 'react'
import { useSlackSearchSetup } from '@/components/integrations/use-slack-search-setup'
import {
  ActionRow,
  Muted,
  Preformatted,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  Button,
  Disclosure,
  FieldFrame,
  InlineNotice,
  Modal,
  SecretField,
  StatusTag,
  TextField,
} from '@/platform/design-system/components'
import { useClipboard } from '@/platform/design-system/components/feedback/use-clipboard'

interface SlackSetupWizardProps {
  organizationId: string
  mode?: 'custom' | 'shared'
  installationId?: string
  appId?: string
  initialName?: string
  onClose: () => void
}

/** App creation, credentials, and consent are one organization-specific setup flow. */
export function SlackSetupWizard(props: SlackSetupWizardProps) {
  const { installationId } = props
  const setup = useSlackSearchSetup(props)
  const { prepare, error, busy, step, configuredAppId } = setup

  if (!prepare.data)
    return (
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) setup.close()
        }}
        title='Sim Search in Slack'
        cancelLabel='Close'
        confirmLabel={prepare.error ? 'Retry' : 'Done'}
        confirmDisabled={prepare.isFetching}
        onConfirm={
          prepare.error
            ? () => {
                void prepare.refetch()
                return false
              }
            : undefined
        }
      >
        {prepare.error ? (
          <InlineNotice intent='danger' message={prepare.error.message} />
        ) : (
          <Muted>Loading Slack setup…</Muted>
        )}
      </Modal>
    )

  if (setup.shared) {
    const unavailable = !prepare.data.sharedAppId
    const message =
      error?.message ?? (unavailable ? 'Sim Search installation is unavailable. Try again.' : null)
    return (
      <Modal
        open
        onOpenChange={(open) => {
          if (!open && !setup.dismissBlocked) setup.close()
        }}
        title='Install the Sim Search app'
        confirmLabel={busy ? 'Connecting…' : 'Continue with Slack'}
        confirmDisabled={busy || unavailable || Boolean(prepare.error)}
        pending={setup.dismissBlocked}
        onConfirm={async () => {
          await setup.installShared()
          return false
        }}
      >
        <Muted>
          Add Sim Search to your Slack workspace to ask questions and get answers from your
          connected sources.
        </Muted>
        {message && <InlineNotice intent='danger' message={message} />}
        {(prepare.error || unavailable) && (
          <div>
            <Button
              size='compact'
              disabled={prepare.isFetching}
              onClick={() => void prepare.refetch()}
            >
              Retry
            </Button>
          </div>
        )}
      </Modal>
    )
  }

  const placeholderFor = (fallback: string) =>
    installationId ? 'Leave blank to keep the saved value' : fallback

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !setup.dismissBlocked) setup.close()
      }}
      title={setup.title}
      confirmLabel={busy ? 'Connecting…' : step === 'credentials' ? 'Connect app' : 'Continue'}
      confirmDisabled={setup.continueDisabled}
      pending={busy}
      onBack={
        step === 'manifest'
          ? undefined
          : () => {
              setup.oauth.reset()
              setup.connect.reset()
              setup.setStep(step === 'credentials' ? 'token' : 'manifest')
            }
      }
      onConfirm={async () => {
        await setup.advance()
        return false
      }}
    >
      {step === 'manifest' && (
        <FieldFrame label='App manifest'>
          <SlackManifest
            manifest={prepare.data.manifest}
            createAppUrl={configuredAppId ? undefined : prepare.data.createAppUrl}
            disabled={Boolean(prepare.error)}
          />
          <Muted>
            {configuredAppId
              ? 'In your Slack app, open App Manifest, replace the JSON, and save changes.'
              : 'Create Slack app opens Slack with this manifest already filled in. Select your workspace, review the configuration, and click Create.'}
          </Muted>
          {configuredAppId && (
            <div>
              <Button
                size='compact'
                render={
                  <a
                    href={`https://api.slack.com/apps/${encodeURIComponent(configuredAppId)}`}
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    Open app settings
                  </a>
                }
              >
                Open app settings
              </Button>
            </div>
          )}
        </FieldFrame>
      )}
      {step === 'credentials' && (
        <>
          <Muted>
            Open Basic Information → App Credentials in the same Slack app. Copy these values, then
            connect the app to Sim.
          </Muted>
          <TextField
            label='Client ID'
            value={setup.clientId}
            onChange={setup.setClientId}
            placeholder={placeholderFor('Paste your Slack app’s client ID')}
            required={!installationId}
            autoComplete='off'
          />
          <SecretField
            label='Client Secret'
            value={setup.clientSecret}
            onChange={setup.setClientSecret}
            placeholder={placeholderFor('Paste your Slack app’s client secret')}
            required={!installationId}
          />
          <SecretField
            label='Signing Secret'
            value={setup.signingSecret}
            onChange={setup.setSigningSecret}
            placeholder={placeholderFor('Paste your Slack app’s signing secret')}
            required={!installationId}
          />
        </>
      )}
      {step === 'token' && (
        <>
          <Muted>
            Open OAuth &amp; Permissions in Slack, choose Install to Workspace (or Reinstall to
            Workspace), and approve access. Then copy the Bot User OAuth Token below.
          </Muted>
          <SecretField
            label='Bot User OAuth Token'
            value={setup.botToken}
            onChange={setup.setBotToken}
            placeholder='xoxb-...'
            required
          />
        </>
      )}
      {error && <InlineNotice intent='danger' message={error.message} />}
      {prepare.error && (
        <div>
          <Button
            size='compact'
            disabled={prepare.isFetching}
            onClick={() => void prepare.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
    </Modal>
  )
}

interface SlackManifestProps {
  manifest: string
  createAppUrl?: string
  disabled: boolean
}

/** Opens new app creation or provides the manifest for updating an existing app. */
function SlackManifest({ manifest, createAppUrl, disabled }: SlackManifestProps) {
  const { copy } = useClipboard()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  if (createAppUrl)
    return (
      <div>
        {disabled || !manifest ? (
          <Button variant='primary' size='compact' disabled>
            Create Slack app
          </Button>
        ) : (
          <Button
            variant='primary'
            size='compact'
            render={
              <a href={createAppUrl} target='_blank' rel='noopener noreferrer'>
                Create Slack app
              </a>
            }
          >
            Create Slack app
          </Button>
        )}
      </div>
    )
  async function copyManifest() {
    setCopyState((await copy(manifest)) ? 'copied' : 'failed')
  }
  return (
    <>
      <ActionRow>
        <Button
          variant='primary'
          size='compact'
          disabled={disabled || !manifest}
          onClick={() => void copyManifest()}
        >
          Copy manifest
        </Button>
        {copyState === 'copied' && <StatusTag live label='Manifest copied' intent='success' />}
      </ActionRow>
      {copyState === 'failed' && (
        <InlineNotice
          intent='danger'
          message='Could not copy the manifest. Allow clipboard access and try again.'
        />
      )}
      <Disclosure chevron label='View manifest'>
        <Preformatted>{manifest}</Preformatted>
      </Disclosure>
    </>
  )
}
