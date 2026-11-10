'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { Disclosure } from '@sim/emcn/disclosure'
import { TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal, MultiStepModal } from '@sim/emcn/modal'
import { InlineNotice } from '@sim/emcn/status'
import {
  FieldStack,
  Muted,
  Preformatted,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type { SetupTarget, SlackSetupFlow } from '@/platform/lib/data/slack-search-model'

interface SlackSetupDialogProps {
  target: SetupTarget
  flow: SlackSetupFlow
}

function ManifestFailure({ flow }: { flow: SlackSetupFlow }) {
  if (!flow.manifestError) return null
  return (
    <>
      <InlineNotice intent='danger' message={flow.manifestError} />
      <div>
        <Button size='compact' disabled={flow.retrying} onClick={flow.retryManifest}>
          Retry
        </Button>
      </div>
    </>
  )
}

export function SlackSetupDialog({ target, flow }: SlackSetupDialogProps) {
  const [botToken, setBotToken] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const editing = Boolean(target.previous)
  const appId = flow.existingAppId
  function change(open: boolean) {
    if (!open && !flow.pending) flow.close()
  }
  if (target.mode === 'shared') {
    const unavailable = Boolean(flow.manifest) && !flow.sharedAvailable
    return (
      <Modal
        open
        onOpenChange={change}
        title='Install the Sim Search app'
        confirmLabel='Continue with Slack'
        confirmDisabled={!flow.manifest || unavailable}
        pending={flow.pending}
        onConfirm={flow.installShared}
      >
        {unavailable && (
          <InlineNotice
            intent='danger'
            message='Sim Search installation is unavailable. Try again.'
          />
        )}
        <ManifestFailure flow={flow} />
      </Modal>
    )
  }
  const placeholder = editing ? 'Leave blank to keep the saved value' : undefined
  return (
    <MultiStepModal
      open
      onOpenChange={change}
      title='Set up Sim Search in Slack'
      confirmLabel='Connect app'
      pending={flow.pending}
      onConfirm={() => flow.connect({ botToken, clientId, clientSecret, signingSecret })}
      steps={[
        {
          title: appId ? 'Update Slack app' : 'Create Slack app',
          description: appId
            ? 'In your Slack app, open App Manifest, replace the JSON, and save changes.'
            : 'Create the Slack app with this manifest. Select your workspace, review the configuration, and click Create.',
          continueDisabled: !flow.manifest,
          content: (
            <FieldStack>
              {flow.manifest && (
                <>
                  <Button
                    size='compact'
                    render={
                      <a
                        aria-label={appId ? 'Open app settings' : 'Create Slack app'}
                        href={
                          appId
                            ? `https://api.slack.com/apps/${encodeURIComponent(appId)}`
                            : flow.manifest.createAppUrl
                        }
                        target='_blank'
                        rel='noopener noreferrer'
                      >
                        {appId ? 'Open app settings' : 'Create Slack app'}
                      </a>
                    }
                  >
                    {appId ? 'Open app settings' : 'Create Slack app'}
                  </Button>
                  {appId && (
                    <Disclosure
                      label='App manifest'
                      actions={
                        <CopyButton label='Copy app manifest' text={flow.manifest.manifest} />
                      }
                    >
                      <Preformatted>{flow.manifest.manifest}</Preformatted>
                    </Disclosure>
                  )}
                </>
              )}
              <ManifestFailure flow={flow} />
            </FieldStack>
          ),
        },
        {
          title: 'Install Slack app',
          description:
            'Open OAuth & Permissions in Slack, choose Install to Workspace (or Reinstall to Workspace), and approve access.',
          continueDisabled: !botToken.trim(),
          content: (
            <SecretField
              label='Bot user OAuth token'
              placeholder='xoxb-…'
              value={botToken}
              onChange={setBotToken}
            />
          ),
        },
        {
          title: 'Slack app credentials',
          content: (
            <FieldStack>
              <Muted>
                Open Basic Information → App Credentials in the same Slack app. Copy these values to
                connect it to Sim.
              </Muted>
              <TextField
                label='Client ID'
                placeholder={placeholder ?? 'Slack client ID'}
                value={clientId}
                onChange={setClientId}
              />
              <SecretField
                label='Client secret'
                placeholder={placeholder ?? 'Slack client secret'}
                value={clientSecret}
                onChange={setClientSecret}
              />
              <SecretField
                label='Signing secret'
                placeholder={placeholder ?? 'Slack signing secret'}
                value={signingSecret}
                onChange={setSigningSecret}
              />
            </FieldStack>
          ),
          continueDisabled:
            !editing && (!clientId.trim() || !clientSecret.trim() || !signingSecret.trim()),
        },
      ]}
    />
  )
}
