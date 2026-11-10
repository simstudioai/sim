'use client'

import { Button, IconButton } from '@sim/emcn/button'
import { FieldFrame, TextField } from '@sim/emcn/field'
import { Input } from '@sim/emcn/field/inputs'
import { SecretField } from '@sim/emcn/field/value-fields'
import { MultiStepModal } from '@sim/emcn/modal'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { ExecutionSteps } from '@sim/emcn-platform/execution-steps'
import styles from '@/app/(product)/_components/service-account-modal/slack-bot-modal.module.css'
import {
  type ResourceScope,
  type SlackSlashCommandDraft,
  useSlackBotForm,
} from '@/platform/lib/data/credentials'

const CREATE_STEPS = [
  {
    id: 'open',
    description: 'Open Slack with the manifest for your selected permissions already filled in.',
  },
  {
    id: 'create',
    description: 'Select your workspace, review the configuration, then click Create.',
  },
] as const

const TOKEN_STEPS = [
  {
    id: 'install',
    description: 'In Slack, open OAuth & Permissions → Install to Workspace and approve access.',
  },
  { id: 'copy', description: 'Copy the Bot User OAuth Token (starts with xoxb-).' },
  { id: 'paste', description: 'Paste it into the field below, then click Continue.' },
] as const

const SECRET_STEPS = [
  { id: 'open', description: 'In your Slack app, open Basic Information.' },
  { id: 'copy', description: 'Find Signing Secret and click Show, then copy it.' },
  { id: 'paste', description: 'Paste it into the field below.' },
] as const

const ALL_PERMISSIONS_HINT =
  'All additional permissions enabled — the bot can read messages, react, access files and users, and people can authorize it through Connected accounts.'

interface SlackBotModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ResourceScope
  /** The vendor the setup is titled with (family name, e.g. "Slack"). */
  serviceName: string
  /** Receives the new credential id so the picker can select it. */
  onCreated: (credentialId: string) => void
}

/**
 * Creates a reusable custom Slack bot credential from the credential picker: name the bot and
 * choose its permissions and slash commands, open Slack with the generated manifest, then paste the
 * Bot Token and Signing Secret. The manifest already points Slack at this credential's ingest URL,
 * so the bot is verified and saved on the last step.
 */
export function SlackBotModal({
  open,
  onOpenChange,
  scope,
  serviceName,
  onCreated,
}: SlackBotModalProps) {
  const form = useSlackBotForm({ open, scope, onCreated })

  return (
    <MultiStepModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Create a custom ${serviceName} bot`}
      confirmLabel={form.isPending ? 'Connecting…' : 'Connect bot'}
      confirmDisabled={form.configurationInvalid || !form.botToken.trim()}
      onConfirm={() => form.submit()}
      steps={[
        {
          continueDisabled: form.configurationInvalid,
          content: (
            <>
              <TextField
                label='Bot name'
                value={form.appName}
                onChange={form.setAppName}
                placeholder={form.defaultAppName}
                error={form.nameError}
              />
              <TextField
                label='Description'
                value={form.appDescription}
                onChange={form.setAppDescription}
                placeholder="Optional — shown on the bot's Slack profile"
                maxLength={140}
                error={form.descriptionError}
              />
              <MultiSelect
                label='Additional permissions'
                value={form.capabilityIds}
                onValueChange={form.setCapabilityIds}
                options={form.capabilityOptions}
                searchLabel='Search permissions'
                placeholder='No additional permissions'
                hint={form.allCapabilitiesSelected ? ALL_PERMISSIONS_HINT : undefined}
              />
              <SlashCommandsEditor
                commands={form.slashCommands}
                canAdd={form.canAddSlashCommand}
                error={form.slashCommandsError}
                onAdd={form.addSlashCommand}
                onUpdate={form.updateSlashCommand}
                onRemove={form.removeSlashCommand}
              />
            </>
          ),
        },
        {
          title: 'Create the app in Slack',
          content: (
            <>
              <div className={styles.actions}>
                {form.createAppUrl ? (
                  <Button
                    variant='secondary'
                    size='compact'
                    trailingIcon='I030'
                    render={
                      <a href={form.createAppUrl} target='_blank' rel='noopener noreferrer'>
                        Create Slack app
                      </a>
                    }
                  >
                    Create Slack app
                  </Button>
                ) : (
                  <Button variant='secondary' size='compact' trailingIcon='I030' disabled>
                    Create Slack app
                  </Button>
                )}
              </div>
              <ExecutionSteps title='In Slack' steps={CREATE_STEPS} />
            </>
          ),
        },
        {
          title: 'Install and paste your Bot Token',
          continueDisabled: !form.botToken.trim(),
          content: (
            <>
              <ExecutionSteps title='In Slack' steps={TOKEN_STEPS} />
              <SecretField
                label='Bot token'
                value={form.botToken}
                onChange={form.setBotToken}
                placeholder='xoxb-...'
              />
            </>
          ),
        },
        {
          title: 'Paste your Signing Secret',
          continueDisabled: !form.signingSecret.trim(),
          content: (
            <>
              <ExecutionSteps title='In Slack' steps={SECRET_STEPS} />
              <SecretField
                label='Signing secret'
                value={form.signingSecret}
                onChange={form.setSigningSecret}
                placeholder='Paste your signing secret'
              />
            </>
          ),
        },
      ]}
    />
  )
}

interface SlashCommandsEditorProps {
  commands: readonly SlackSlashCommandDraft[]
  canAdd: boolean
  error?: string
  onAdd: () => void
  onUpdate: (id: string, field: 'command' | 'description' | 'usageHint', value: string) => void
  onRemove: (id: string) => void
}

function SlashCommandsEditor({
  commands,
  canAdd,
  error,
  onAdd,
  onUpdate,
  onRemove,
}: SlashCommandsEditorProps) {
  return (
    <FieldFrame label='Slash commands' optional error={error}>
      <div className={styles.actions}>
        <Button size='compact' icon='I074' disabled={!canAdd} onClick={onAdd}>
          Add
        </Button>
      </div>
      {commands.length > 0 && (
        <div className={styles.commands}>
          {commands.map((entry, index) => (
            <div key={entry.id} className={styles.command}>
              <div className={styles.inputs}>
                <Input
                  label={`Slash command ${index + 1}`}
                  value={entry.command}
                  onChange={(value) => onUpdate(entry.id, 'command', value)}
                  placeholder='/ask-sim'
                  maxLength={32}
                />
                <Input
                  label={`Slash command ${index + 1} description`}
                  value={entry.description}
                  onChange={(value) => onUpdate(entry.id, 'description', value)}
                  placeholder='Short description shown in Slack'
                  maxLength={2000}
                />
                <Input
                  label={`Slash command ${index + 1} usage hint`}
                  value={entry.usageHint ?? ''}
                  onChange={(value) => onUpdate(entry.id, 'usageHint', value)}
                  placeholder='Usage hint (optional), e.g. question or task'
                  maxLength={1000}
                />
              </div>
              <IconButton
                label={`Remove slash command ${index + 1}`}
                icon='trash'
                onClick={() => onRemove(entry.id)}
              />
            </div>
          ))}
        </div>
      )}
    </FieldFrame>
  )
}
