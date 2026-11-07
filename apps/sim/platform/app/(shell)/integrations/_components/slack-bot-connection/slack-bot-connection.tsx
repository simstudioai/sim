'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { TextAreaField, TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { MultiStepModal } from '@sim/emcn/modal'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { ExecutionSteps } from '@sim/emcn-platform/execution-steps'
import { ConnectionAccess } from '@/platform/app/(shell)/integrations/_components/connection-access/connection-access'
import type { CredentialDraft } from '@/platform/app/(shell)/integrations/_components/credential-connect/types'
import styles from '@/platform/app/(shell)/integrations/_components/slack-bot-connection/slack-bot-connection.module.css'
import {
  type SlackCommandDraft,
  SlackSlashCommands,
  slashCommandsError,
} from '@/platform/app/(shell)/integrations/_components/slack-slash-commands'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'
import {
  slackBotCapabilities,
  slackManagedUserAuthorization,
} from '@/platform/lib/integrations/metadata.generated'

const CAPABILITIES = [...slackBotCapabilities, slackManagedUserAuthorization]

interface SlackBotConnectionProps {
  initial?: IntegrationCredential
  onClose: () => void
  onSubmit: (draft: CredentialDraft) => void
}

/** Collects a local connection draft; secret fields never leave this mounted dialog. */
export function SlackBotConnection({ initial, onClose, onSubmit }: SlackBotConnectionProps) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [capabilities, setCapabilities] = useState<string[]>(() =>
    CAPABILITIES.filter(({ defaultChecked }) => defaultChecked).map(({ id }) => id)
  )
  const [commands, setCommands] = useState<SlackCommandDraft[]>([])
  const [botToken, setBotToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const reconnect = Boolean(initial)
  const nameError =
    !reconnect && displayName && !/^[a-zA-Z0-9 ._-]+$/.test(displayName.trim())
      ? 'Use letters, numbers, spaces, periods, hyphens, or underscores.'
      : undefined
  const configurationInvalid =
    !displayName.trim() ||
    Boolean(nameError) ||
    (!reconnect && Boolean(slashCommandsError(commands)))

  function close() {
    setBotToken('')
    setSigningSecret('')
    onClose()
  }

  return (
    <MultiStepModal
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
      title={reconnect ? 'Reconnect Slack bot' : 'Connect Slack bot'}
      confirmLabel={reconnect ? 'Reconnect' : 'Connect bot'}
      confirmDisabled={configurationInvalid || !botToken.trim() || !signingSecret.trim()}
      onConfirm={() => {
        onSubmit({
          displayName: displayName.trim(),
          description: description.trim(),
        })
        setBotToken('')
        setSigningSecret('')
      }}
      steps={[
        {
          title: reconnect ? 'Reconnect Slack bot' : 'Configure Slack bot',
          continueDisabled: configurationInvalid,
          content: (
            <>
              <TextField
                label='Bot name'
                value={displayName}
                onChange={setDisplayName}
                placeholder='Sim Bot'
                maxLength={35}
                error={nameError}
                required
              />
              <TextAreaField
                label='Description'
                value={description}
                onChange={setDescription}
                placeholder='Shown on the bot’s Slack profile'
                maxLength={140}
                optional
              />
              {!reconnect && (
                <>
                  <MultiSelect
                    label='Additional permissions'
                    value={capabilities}
                    onValueChange={setCapabilities}
                    options={CAPABILITIES.map(({ id, label }) => ({ value: id, label }))}
                    searchLabel='Search permissions'
                    placeholder='No additional permissions'
                  />
                  <SlackSlashCommands commands={commands} onChange={setCommands} />
                </>
              )}
            </>
          ),
        },
        {
          title: reconnect ? 'Open your app in Slack' : 'Set up your app in Slack',
          content: (
            <>
              <div className={styles.actions}>
                <Button
                  size='compact'
                  trailingIcon='I030'
                  render={
                    <a
                      aria-label='Open Slack apps'
                      href='https://api.slack.com/apps'
                      target='_blank'
                      rel='noopener noreferrer'
                    >
                      Open Slack apps
                    </a>
                  }
                >
                  Open Slack apps
                </Button>
              </div>
              <ExecutionSteps
                title={reconnect ? 'Existing app' : 'App setup'}
                steps={
                  reconnect
                    ? [
                        {
                          id: 'open',
                          description: 'Open the existing app in your Slack workspace.',
                        },
                        {
                          id: 'keep',
                          description:
                            'Keep its existing App Manifest and permissions. Reconnecting replaces its credentials in Sim.',
                        },
                      ]
                    : [
                        {
                          id: 'create',
                          description:
                            'Create an app in your Slack workspace and configure its bot identity.',
                        },
                        {
                          id: 'review',
                          description:
                            'Review its permissions, event subscriptions, and any slash commands before installing.',
                        },
                      ]
                }
              />
              {!reconnect && capabilities.length > 0 && (
                <ConnectionAccess
                  title='Selected permissions'
                  permissions={CAPABILITIES.filter(({ id }) => capabilities.includes(id))}
                />
              )}
            </>
          ),
        },
        {
          title: 'Install and copy the bot token',
          description: reconnect
            ? 'Open OAuth & Permissions in your existing Slack app. Reinstall only if Slack requests it, then copy the Bot User OAuth Token.'
            : 'In Slack, open OAuth & Permissions, choose Install to Workspace, and approve access. Copy the Bot User OAuth Token.',
          continueDisabled: !botToken.trim(),
          content: (
            <SecretField
              label='Bot token'
              value={botToken}
              onChange={setBotToken}
              placeholder='xoxb-…'
              required
            />
          ),
        },
        {
          title: 'Copy the signing secret',
          description:
            'Open Basic Information in the same Slack app. Under App Credentials, reveal and copy the Signing Secret.',
          content: (
            <SecretField
              label='Signing secret'
              value={signingSecret}
              onChange={setSigningSecret}
              placeholder='Paste signing secret'
              required
            />
          ),
        },
      ]}
    />
  )
}
