'use client'

import { useState } from 'react'
import {
  FieldStack,
  Muted,
  Preformatted,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  Button,
  CopyButton,
  Disclosure,
  Modal,
  MultiStepModal,
  SecretField,
  TextField,
} from '@/platform/design-system/components'
import type { SlackSearchInstallationView } from '@/platform/lib/data/settings-slack'

export interface SetupTarget {
  mode: 'shared' | 'custom'
  previous?: SlackSearchInstallationView
}

export interface ManifestView {
  manifest: string
  createAppUrl: string
}

interface SlackSetupDialogProps {
  target: SetupTarget
  manifest: ManifestView
  onClose: () => void
  onConnect: () => void
}

export function SlackSetupDialog({ target, manifest, onClose, onConnect }: SlackSetupDialogProps) {
  const [botToken, setBotToken] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const editing = Boolean(target.previous)
  function change(open: boolean) {
    if (!open) onClose()
  }
  if (target.mode === 'shared')
    return (
      <Modal
        open
        onOpenChange={change}
        title='Install the Sim Search app'
        description='Add Sim Search to your Slack workspace to ask questions and get answers from your connected sources.'
        confirmLabel='Continue with Slack'
        onConfirm={onConnect}
      />
    )
  const placeholder = editing ? 'Leave blank to keep the saved value' : undefined
  return (
    <MultiStepModal
      open
      onOpenChange={change}
      title='Set up Sim Search in Slack'
      confirmLabel='Connect app'
      onConfirm={onConnect}
      steps={[
        {
          title: editing ? 'Update Slack app' : 'Create Slack app',
          description: editing
            ? 'In your Slack app, open App Manifest, replace the JSON, and save changes.'
            : 'Create the Slack app with this manifest. Select your workspace, review the configuration, and click Create.',
          content: (
            <FieldStack>
              <Button
                size='compact'
                render={
                  <a
                    aria-label={editing ? 'Open app settings' : 'Create Slack app'}
                    href={
                      target.previous
                        ? `https://api.slack.com/apps/${encodeURIComponent(target.previous.appId)}`
                        : manifest.createAppUrl
                    }
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    {editing ? 'Open app settings' : 'Create Slack app'}
                  </a>
                }
              >
                {editing ? 'Open app settings' : 'Create Slack app'}
              </Button>
              {editing && (
                <Disclosure
                  label='App manifest'
                  actions={<CopyButton label='Copy app manifest' text={manifest.manifest} />}
                >
                  <Preformatted>{manifest.manifest}</Preformatted>
                </Disclosure>
              )}
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
              label='Bot User OAuth Token'
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
                label='Client Secret'
                placeholder={placeholder ?? 'Slack client secret'}
                value={clientSecret}
                onChange={setClientSecret}
              />
              <SecretField
                label='Signing Secret'
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
