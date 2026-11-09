'use client'

import { useId, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { MultiStepModal } from '@sim/emcn/modal'
import { InlineNotice, StatusTag } from '@sim/emcn/status'
import { ExecutionSteps } from '@sim/emcn-platform/execution-steps'
import { CapabilityCheckbox } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/slack-setup-wizard/capability-checkbox'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/slack-setup-wizard/slack-setup-wizard.module.css'
import { useSubBlockValue, useWebhookManagement } from '@/platform/lib/data/workflow-editor'
import {
  buildSlackAppCreationUrl,
  buildSlackManifest,
  getSlackAppNameError,
  SLACK_CAPABILITIES,
  type SlackCapabilityGroup,
  useSlackCapabilitySelection,
} from '@/platform/lib/data/workflow-editor/uploads'

const DEFAULT_APP_NAME = 'Sim Workflow Bot'

const GROUP_LABELS: Record<SlackCapabilityGroup, string> = {
  trigger: 'Triggers',
  action: 'Actions',
}

const GROUP_ORDER: readonly SlackCapabilityGroup[] = ['trigger', 'action']

const CREATE_STEPS = [
  { id: 'open', description: 'Open Slack with your manifest already filled in.' },
  {
    id: 'create',
    description: 'Select your workspace, review the configuration, then choose Create.',
  },
] as const

const TOKEN_STEPS = [
  {
    id: 'install',
    description: 'Open OAuth & Permissions, choose Install to Workspace, and authorize.',
  },
  { id: 'copy', description: 'Copy the Bot User OAuth Token (it starts with xoxb-).' },
  { id: 'paste', description: 'Paste it into the field below.' },
] as const

const SECRET_STEPS = [
  { id: 'open', description: 'In your new Slack app, open Basic Information.' },
  { id: 'copy', description: 'Find Signing Secret, choose Show, then copy it.' },
  { id: 'paste', description: 'Paste it into the field below.' },
] as const

interface SlackSetupWizardProps {
  blockId: string
  isPreview?: boolean
  disabled?: boolean
}

/**
 * The Slack app setup wizard behind the `modal` sub-block. The panel shows one launcher; the
 * wizard writes the bot name, capabilities, Bot Token and Signing Secret straight into the block's
 * sibling sub-blocks as they are entered, so those fields are filled by the time it closes.
 */
export function SlackSetupWizard({
  blockId,
  isPreview = false,
  disabled = false,
}: SlackSetupWizardProps) {
  const [open, setOpen] = useState(false)
  const controlsDisabled = isPreview || disabled

  return (
    <>
      <Button
        variant='secondary'
        size='compact'
        trailingIcon='I032'
        disabled={controlsDisabled}
        onClick={() => setOpen(true)}
      >
        Set up Slack app
      </Button>
      <WizardModal
        blockId={blockId}
        open={open}
        onOpenChange={setOpen}
        isPreview={isPreview}
        controlsDisabled={controlsDisabled}
      />
    </>
  )
}

interface WizardModalProps {
  blockId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  isPreview: boolean
  controlsDisabled: boolean
}

function WizardModal({
  blockId,
  open,
  onOpenChange,
  isPreview,
  controlsDisabled,
}: WizardModalProps) {
  const { webhookUrl, isLoading } = useWebhookManagement({
    blockId,
    triggerId: 'slack_webhook',
    useWebhookUrl: true,
    isPreview,
  })
  const [appName, setAppName] = useSubBlockValue<string>(blockId, 'botDisplayName')
  const [signingSecret, setSigningSecret] = useSubBlockValue<string>(blockId, 'signingSecret')
  const [botToken, setBotToken] = useSubBlockValue<string>(blockId, 'botToken')
  const selected = useSlackCapabilitySelection(blockId)
  const groupId = useId()

  const displayAppName = appName ?? DEFAULT_APP_NAME
  const manifestAppName = displayAppName.trim() || DEFAULT_APP_NAME
  const nameError = getSlackAppNameError(manifestAppName) ?? undefined
  const effectiveWebhookUrl = !isLoading && webhookUrl ? webhookUrl : null
  const canCreate = effectiveWebhookUrl !== null
  const manifestJson = JSON.stringify(
    buildSlackManifest(selected, { appName: manifestAppName, webhookUrl: effectiveWebhookUrl })
  )

  return (
    <MultiStepModal
      open={open}
      onOpenChange={onOpenChange}
      title='Set up Slack app'
      confirmLabel='Done'
      steps={[
        {
          title: 'Configure your bot',
          continueDisabled: Boolean(nameError),
          content: (
            <>
              <TextField
                label='Bot name'
                value={displayAppName}
                onChange={(next) => {
                  if (!controlsDisabled) setAppName(next)
                }}
                placeholder={DEFAULT_APP_NAME}
                error={nameError}
                disabled={controlsDisabled}
              />
              {GROUP_ORDER.map((group) => {
                const capabilities = SLACK_CAPABILITIES.filter(
                  (capability) => capability.group === group
                )
                if (capabilities.length === 0) return null
                return (
                  <div
                    key={group}
                    className={styles.group}
                    role='group'
                    aria-labelledby={`${groupId}-${group}`}
                  >
                    <span id={`${groupId}-${group}`} className={styles.groupLabel} data-type='T059'>
                      {GROUP_LABELS[group]}
                    </span>
                    <div className={styles.capabilities}>
                      {capabilities.map((capability) => (
                        <CapabilityCheckbox
                          key={capability.id}
                          blockId={blockId}
                          capability={capability}
                          checked={selected.has(capability.id)}
                          disabled={controlsDisabled}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </>
          ),
        },
        {
          title: 'Create the app in Slack',
          continueDisabled: !canCreate,
          content: (
            <>
              <div className={styles.actions}>
                {canCreate ? (
                  <Button
                    variant='secondary'
                    size='compact'
                    trailingIcon='I030'
                    render={
                      <a
                        href={buildSlackAppCreationUrl(manifestJson)}
                        target='_blank'
                        rel='noopener noreferrer'
                      >
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
              {!canCreate && !isLoading && (
                <InlineNotice
                  intent='warning'
                  message='Webhook URL unavailable. Reload the workflow and try again.'
                />
              )}
              <ExecutionSteps title='In Slack' steps={CREATE_STEPS} />
            </>
          ),
        },
        {
          title: 'Install and paste your Bot Token',
          continueDisabled: !botToken?.trim(),
          content: (
            <>
              <ExecutionSteps title='In Slack' steps={TOKEN_STEPS} />
              <SecretField
                label='Bot Token'
                value={botToken ?? ''}
                onChange={(next) => {
                  if (!controlsDisabled) setBotToken(next)
                }}
                placeholder='xoxb-...'
                disabled={controlsDisabled}
              />
            </>
          ),
        },
        {
          title: 'Paste your Signing Secret',
          continueDisabled: !signingSecret?.trim(),
          content: (
            <>
              <ExecutionSteps title='In Slack' steps={SECRET_STEPS} />
              <SecretField
                label='Signing Secret'
                value={signingSecret ?? ''}
                onChange={(next) => {
                  if (!controlsDisabled) setSigningSecret(next)
                }}
                placeholder='Paste your signing secret'
                disabled={controlsDisabled}
              />
            </>
          ),
        },
        {
          title: 'Save and verify the Request URL',
          content: (
            <>
              <p className={styles.prose} data-type='T043'>
                Choose Done, then save and deploy the workflow with these credentials. In Slack,
                open App Manifest and verify the event Request URL before using the trigger.
              </p>
              <div className={styles.statusRows}>
                <CredentialStatus label='Signing Secret' saved={Boolean(signingSecret)} />
                <CredentialStatus label='Bot Token' saved={Boolean(botToken)} />
              </div>
            </>
          ),
        },
      ]}
    />
  )
}

interface CredentialStatusProps {
  label: string
  saved: boolean
}

function CredentialStatus({ label, saved }: CredentialStatusProps) {
  return (
    <div className={styles.statusRow}>
      <span data-type='T043'>{label}</span>
      <StatusTag label={saved ? 'Saved' : 'Not saved yet'} intent={saved ? 'success' : 'neutral'} />
    </div>
  )
}
