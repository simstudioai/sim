'use client'

import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { Check, Clipboard, Info } from 'lucide-react'
import { Checkbox, Input, Label, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  buildSlackManifest,
  SLACK_CAPABILITIES,
  type SlackCapability,
  type SlackCapabilityGroup,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/slack-manifest-generator/capabilities'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useWebhookManagement } from '@/hooks/use-webhook-management'

const DEFAULT_APP_NAME = 'Sim Workflow Bot'

const GROUP_LABELS: Record<SlackCapabilityGroup, string> = {
  trigger: 'Triggers',
  action: 'Actions',
}

const GROUP_ORDER: readonly SlackCapabilityGroup[] = ['trigger', 'action'] as const

const DEFAULT_SELECTED_IDS: readonly string[] = SLACK_CAPABILITIES.filter(
  (c) => c.defaultEnabled
).map((c) => c.id)

interface PersistedManifestConfig {
  appName: string
  selected: string[]
}

interface InstallStep {
  title: string
  detail: ReactNode
}

const INSTALL_STEPS: readonly InstallStep[] = [
  {
    title: 'Create the app from your manifest',
    detail: (
      <>
        Open the{' '}
        <a
          href='https://api.slack.com/apps'
          target='_blank'
          rel='noopener noreferrer'
          className='text-[var(--brand-secondary)] underline underline-offset-2'
        >
          Slack Apps page
        </a>
        , click <strong>Create New App</strong> → <strong>From a manifest</strong>, pick your
        workspace, paste the manifest you copied, and click <strong>Create</strong>.
      </>
    ),
  },
  {
    title: 'Paste your Signing Secret',
    detail: (
      <>
        In your new Slack app, open <strong>Basic Information</strong>, copy the{' '}
        <strong>Signing Secret</strong>, and paste it into the <strong>Signing Secret</strong> field
        above.
      </>
    ),
  },
  {
    title: 'Install the app',
    detail: (
      <>
        Go to <strong>"Install App"</strong> in the left sidebar and install the app into your
        desired Slack workspace and channel.
      </>
    ),
  },
  {
    title: 'Copy the Bot User OAuth Token',
    detail: (
      <>
        Copy the <strong>"Bot User OAuth Token"</strong> (starts with <code>xoxb-</code>) and paste
        it into the <strong>Bot Token</strong> field above to enable file downloads.
      </>
    ),
  },
  {
    title: 'Save changes',
    detail: <>Save changes in both Slack and here.</>,
  },
] as const

interface SlackManifestGeneratorProps {
  blockId: string
  isPreview?: boolean
  disabled?: boolean
}

/**
 * Slack app manifest generator — a full sub-block.
 *
 * @remarks
 * Persists the bot name and selected capabilities into the sub-block store
 * under the `manifestGenerator` key so the user's configuration survives
 * reloads. The manifest itself is regenerated on-the-fly from that persisted
 * state and copied to the clipboard via a single full-width button. Setup
 * steps for actually installing the Slack app live behind inline info
 * tooltips instead of consuming vertical space.
 */
export function SlackManifestGenerator({
  blockId,
  isPreview = false,
  disabled = false,
}: SlackManifestGeneratorProps) {
  const { webhookUrl, isLoading } = useWebhookManagement({
    blockId,
    triggerId: 'slack_webhook',
    useWebhookUrl: true,
    isPreview,
  })

  const [persisted, setPersisted] = useSubBlockValue<PersistedManifestConfig>(
    blockId,
    'manifestGenerator'
  )

  const appName = persisted?.appName ?? DEFAULT_APP_NAME
  const selectedIds = persisted?.selected ?? DEFAULT_SELECTED_IDS
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  const [copied, setCopied] = useState<boolean>(false)

  const effectiveWebhookUrl = !isLoading && webhookUrl ? webhookUrl : null
  const canCopy = effectiveWebhookUrl !== null
  const controlsDisabled = isPreview || disabled

  const manifestJson = useMemo(() => {
    const manifest = buildSlackManifest(selected, {
      appName,
      webhookUrl: effectiveWebhookUrl,
    })
    return JSON.stringify(manifest, null, 2)
  }, [selected, appName, effectiveWebhookUrl])

  const handleAppNameChange = useCallback(
    (value: string) => {
      if (controlsDisabled) return
      setPersisted({ appName: value, selected: Array.from(selected) })
    },
    [controlsDisabled, selected, setPersisted]
  )

  const handleToggle = useCallback(
    (id: string, checked: boolean) => {
      if (controlsDisabled) return
      const next = new Set(selected)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      setPersisted({ appName, selected: Array.from(next) })
    },
    [controlsDisabled, selected, appName, setPersisted]
  )

  const handleCopy = useCallback(() => {
    if (!canCopy) return
    navigator.clipboard.writeText(manifestJson)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [canCopy, manifestJson])

  return (
    <div className='space-y-5 rounded-md border bg-[var(--surface-2)] p-4 shadow-sm'>
      <section className='space-y-3'>
        <div className='font-medium text-[var(--text-muted)] text-xs uppercase tracking-wide'>
          Setup
        </div>
        <div className='space-y-1.5'>
          <Label
            htmlFor={`${blockId}-slack-manifest-app-name`}
            className='font-medium text-[var(--text-secondary)] text-xs'
          >
            Bot name
          </Label>
          <Input
            id={`${blockId}-slack-manifest-app-name`}
            value={appName}
            onChange={(e) => handleAppNameChange(e.target.value)}
            disabled={controlsDisabled}
            placeholder={DEFAULT_APP_NAME}
            className='h-9 text-sm'
          />
        </div>
        <div className='space-y-3'>
          {GROUP_ORDER.map((group) => {
            const items = SLACK_CAPABILITIES.filter((c) => c.group === group)
            if (items.length === 0) return null
            return (
              <CapabilityGroup
                key={group}
                blockId={blockId}
                label={GROUP_LABELS[group]}
                capabilities={items}
                selected={selected}
                disabled={controlsDisabled}
                onToggle={handleToggle}
              />
            )
          })}
        </div>
      </section>

      <button
        type='button'
        onClick={handleCopy}
        disabled={!canCopy}
        className={cn(
          'flex w-full items-center justify-between rounded-md border border-[var(--border-muted)] bg-[var(--surface-1)] px-3 py-2 text-left transition-colors',
          canCopy
            ? 'cursor-pointer hover-hover:bg-[var(--surface-hover)]'
            : 'cursor-not-allowed opacity-70'
        )}
      >
        <span className='font-medium text-[var(--text-secondary)] text-sm'>
          {canCopy ? 'Slack app manifest (JSON)' : 'Deploy once to lock in the webhook URL'}
        </span>
        {canCopy &&
          (copied ? (
            <Check className='h-3 w-3 text-green-500' />
          ) : (
            <Clipboard className='h-3 w-3 text-muted-foreground' />
          ))}
      </button>

      <section className='space-y-2'>
        <div className='font-medium text-[var(--text-muted)] text-xs uppercase tracking-wide'>
          After you copy, in Slack
        </div>
        <ol className='space-y-1'>
          {INSTALL_STEPS.map((step, index) => (
            <li
              key={step.title}
              className='flex items-center gap-1.5 text-[var(--text-secondary)] text-sm'
            >
              <span className='shrink-0 text-[var(--text-muted)] tabular-nums'>{index + 1}.</span>
              <span>{step.title}</span>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Info className='h-[14px] w-[14px] cursor-default text-[var(--text-muted)]' />
                </Tooltip.Trigger>
                <Tooltip.Content side='top' align='start' className='max-w-sm'>
                  <p className='leading-relaxed'>{step.detail}</p>
                </Tooltip.Content>
              </Tooltip.Root>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

interface CapabilityGroupProps {
  blockId: string
  label: string
  capabilities: readonly SlackCapability[]
  selected: ReadonlySet<string>
  disabled: boolean
  onToggle: (id: string, checked: boolean) => void
}

function CapabilityGroup({
  blockId,
  label,
  capabilities,
  selected,
  disabled,
  onToggle,
}: CapabilityGroupProps) {
  return (
    <div className='space-y-2'>
      <div className='font-medium text-[var(--text-muted)] text-xs uppercase tracking-wide'>
        {label}
      </div>
      <div className='flex flex-col gap-y-2.5'>
        {capabilities.map((c) => {
          const id = `${blockId}-slack-manifest-${c.id}`
          return (
            <div key={c.id} className='flex items-center gap-1.5'>
              <Checkbox
                id={id}
                checked={selected.has(c.id)}
                onCheckedChange={(checked) => onToggle(c.id, checked === true)}
                disabled={disabled}
              />
              <Label
                htmlFor={id}
                className='cursor-pointer text-[var(--text-primary)] text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-60'
              >
                {c.label}
              </Label>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Info className='h-[14px] w-[14px] cursor-default text-[var(--text-muted)]' />
                </Tooltip.Trigger>
                <Tooltip.Content side='top' align='start' className='max-w-xs'>
                  <p>{c.description}</p>
                </Tooltip.Content>
              </Tooltip.Root>
            </div>
          )
        })}
      </div>
    </div>
  )
}
