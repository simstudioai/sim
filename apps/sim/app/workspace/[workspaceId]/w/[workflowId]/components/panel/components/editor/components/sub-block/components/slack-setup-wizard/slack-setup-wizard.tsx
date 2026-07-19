'use client'

import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { Checkbox, cn, Input, Label, SecretInput, Tooltip, Wizard } from '@sim/emcn'
import { Check, ChevronRight, Clipboard, Info } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useShallow } from 'zustand/react/shallow'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useWebhookManagement } from '@/hooks/use-webhook-management'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import {
  buildSlackManifest,
  SLACK_CAPABILITIES,
  type SlackCapability,
  type SlackCapabilityGroup,
} from '@/triggers/slack/capabilities'

const DEFAULT_APP_NAME = 'Sim Workflow Bot'

const GROUP_LABELS: Record<SlackCapabilityGroup, string> = {
  trigger: 'Triggers',
  action: 'Actions',
}

const GROUP_ORDER: readonly SlackCapabilityGroup[] = ['trigger', 'action'] as const

const MODAL_HEIGHT_CLASS = 'h-[580px]'

interface SlackSetupWizardProps {
  blockId: string
  isPreview?: boolean
  disabled?: boolean
}

/**
 * Slack app setup wizard sub-block.
 *
 * @remarks
 * The panel renders a single launcher button. The wizard lives in a modal
 * with a fixed-height body so navigating between steps doesn't resize the
 * dialog. Credentials are written directly into the sibling `signingSecret`
 * and `botToken` sub-blocks via the shared sub-block store, so those fields
 * in the panel are populated by the time the user clicks Done.
 */
export function SlackSetupWizard({
  blockId,
  isPreview = false,
  disabled = false,
}: SlackSetupWizardProps) {
  const t = useTranslations('auto')
  const [open, setOpen] = useState<boolean>(false)
  const launcherDisabled = isPreview || disabled

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        disabled={launcherDisabled}
        className={cn(
          'flex w-full items-center justify-between rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] px-2 py-1.5 text-left transition-colors',
          launcherDisabled
            ? 'cursor-not-allowed opacity-70'
            : 'cursor-pointer hover-hover:bg-[var(--surface-6)]'
        )}
      >
        <span className='font-medium font-sans text-[var(--text-primary)] text-sm'>
          {t('setup_slack_app')}
        </span>
        <ChevronRight className='size-[14px] text-[var(--text-muted)]' />
      </button>

      <WizardModal
        blockId={blockId}
        open={open}
        onOpenChange={setOpen}
        isPreview={isPreview}
        disabled={disabled}
      />
    </>
  )
}

interface WizardModalProps {
  blockId: string
  open: boolean
  onOpenChange: (next: boolean) => void
  isPreview: boolean
  disabled: boolean
}

function WizardModal({ blockId, open, onOpenChange, isPreview, disabled }: WizardModalProps) {
  const t = useTranslations('auto')
  const [step, setStep] = useState<number>(0)

  const { webhookUrl, isLoading } = useWebhookManagement({
    blockId,
    triggerId: 'slack_webhook',
    useWebhookUrl: true,
    isPreview,
  })

  const [appName, setAppName] = useSubBlockValue<string>(blockId, 'botDisplayName')
  const [signingSecret, setSigningSecret] = useSubBlockValue<string>(blockId, 'signingSecret')
  const [botToken, setBotToken] = useSubBlockValue<string>(blockId, 'botToken')
  const selected = useCapabilitySelection(blockId)

  const displayAppName = appName ?? DEFAULT_APP_NAME
  const effectiveWebhookUrl = !isLoading && webhookUrl ? webhookUrl : null
  const canCopy = effectiveWebhookUrl !== null
  const controlsDisabled = isPreview || disabled

  const manifestJson = useMemo(() => {
    const manifest = buildSlackManifest(selected, {
      appName: displayAppName.trim() || DEFAULT_APP_NAME,
      webhookUrl: effectiveWebhookUrl,
    })
    return JSON.stringify(manifest, null, 2)
  }, [selected, displayAppName, effectiveWebhookUrl])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setStep(0)
      onOpenChange(next)
    },
    [onOpenChange]
  )

  return (
    <Wizard
      open={open}
      onOpenChange={handleOpenChange}
      currentStep={step}
      onStepChange={setStep}
      size='lg'
      height={MODAL_HEIGHT_CLASS}
    >
      <Wizard.Step title={t('configure_your_bot')}>
        <StepConfigure
          blockId={blockId}
          appName={displayAppName}
          onAppNameChange={(v) => {
            if (!controlsDisabled) setAppName(v)
          }}
          selected={selected}
          disabled={controlsDisabled}
        />
      </Wizard.Step>
      <Wizard.Step title={t('create_the_app_in_slack')}>
        <StepCreate manifestJson={manifestJson} canCopy={canCopy} />
      </Wizard.Step>
      <Wizard.Step title={t('paste_your_signing_secret')}>
        <StepSecret
          blockId={blockId}
          value={signingSecret ?? ''}
          onChange={(v) => {
            if (!controlsDisabled) setSigningSecret(v)
          }}
          disabled={controlsDisabled}
        />
      </Wizard.Step>
      <Wizard.Step title={t('install_and_paste_your_bot_token')}>
        <StepToken
          blockId={blockId}
          value={botToken ?? ''}
          onChange={(v) => {
            if (!controlsDisabled) setBotToken(v)
          }}
          disabled={controlsDisabled}
        />
      </Wizard.Step>
      <Wizard.Step title={t('all_set')}>
        <StepDone hasSigningSecret={Boolean(signingSecret)} hasBotToken={Boolean(botToken)} />
      </Wizard.Step>
    </Wizard>
  )
}

interface SubStepListProps {
  children: ReactNode
}

function SubStepList({ children }: SubStepListProps) {
  return <ol className='space-y-2.5'>{children}</ol>
}

interface SubStepProps {
  n: number
  children: ReactNode
}

function SubStep({ n, children }: SubStepProps) {
  return (
    <li className='flex gap-2.5'>
      <span className='mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-5)] font-medium text-[var(--text-secondary)] text-xs tabular-nums'>
        {n}
      </span>
      <div className='flex-1 text-[var(--text-secondary)] text-sm leading-relaxed'>{children}</div>
    </li>
  )
}

interface StepConfigureProps {
  blockId: string
  appName: string
  onAppNameChange: (next: string) => void
  selected: ReadonlySet<string>
  disabled: boolean
}

function StepConfigure({
  blockId,
  appName,
  onAppNameChange,
  selected,
  disabled,
}: StepConfigureProps) {
  const t = useTranslations('auto')
  return (
    <div className='space-y-4'>
      <p className='text-[var(--text-secondary)] text-sm leading-relaxed'>
        {t('pick_a_name_and_choose_what')}
      </p>
      <div className='space-y-1.5'>
        <Label
          htmlFor={`${blockId}-wizard-bot-name`}
          className='font-medium text-[var(--text-secondary)] text-xs'
        >
          {t('bot_name')}
        </Label>
        <Input
          id={`${blockId}-wizard-bot-name`}
          value={appName}
          onChange={(e) => onAppNameChange(e.target.value)}
          disabled={disabled}
          placeholder={DEFAULT_APP_NAME}
          className='h-9 text-sm'
        />
      </div>
      <div className='grid grid-cols-2 gap-x-4 gap-y-4'>
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
              disabled={disabled}
            />
          )
        })}
      </div>
    </div>
  )
}

interface StepCreateProps {
  manifestJson: string
  canCopy: boolean
}

function StepCreate({ manifestJson, canCopy }: StepCreateProps) {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const [copied, setCopied] = useState<boolean>(false)
  const [copyFailed, setCopyFailed] = useState<boolean>(false)

  const handleCopy = useCallback(async () => {
    if (!canCopy) return
    try {
      await navigator.clipboard.writeText(manifestJson)
      setCopyFailed(false)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyFailed(true)
    }
  }, [canCopy, manifestJson])

  return (
    <div className='space-y-4'>
      <SubStepList>
        <SubStep n={1}>
          <div>{t('copy_your_manifest')}</div>
          <button
            type='button'
            onClick={handleCopy}
            disabled={!canCopy}
            className={cn(
              'mt-2 inline-flex items-center gap-2 rounded-md border border-[var(--border-muted)] bg-[var(--surface-1)] px-3 py-1.5 text-left transition-colors',
              canCopy
                ? 'cursor-pointer hover-hover:bg-[var(--surface-hover)]'
                : 'cursor-not-allowed opacity-70'
            )}
          >
            <span className='font-medium text-[var(--text-secondary)] text-sm'>
              {canCopy ? tI18n('click_to_copy_manifest') : tI18n('deploy_once_to_lock_in_the')}
            </span>
            {canCopy &&
              (copied ? (
                <Check className='size-[12px] text-[var(--text-success)]' />
              ) : (
                <Clipboard className='size-[12px] text-[var(--text-muted)]' />
              ))}
          </button>
          {copyFailed ? (
            <p className='mt-1.5 text-[var(--text-error)] text-xs'>
              {t('couldn_t_copy_manifest_copy_it')}
            </p>
          ) : null}
        </SubStep>
        <SubStep n={2}>
          {t('open_the')}{' '}
          <a
            href='https://api.slack.com/apps'
            target='_blank'
            rel='noopener noreferrer'
            className='text-[var(--brand-secondary)] underline underline-offset-2'
          >
            {t('slack_apps_page')}
          </a>
          .
        </SubStep>
        <SubStep n={3}>
          {t('click')} <strong>{t('create_new_app')}</strong> →{' '}
          <strong>{t('from_a_manifest')}</strong> {t('and_pick_your_workspace')}
        </SubStep>
        <SubStep n={4}>
          {t('paste_your_manifest_then_click')} <strong>{t('next')}</strong> →{' '}
          <strong>{t('create')}</strong>.
        </SubStep>
      </SubStepList>
    </div>
  )
}

interface StepSecretProps {
  blockId: string
  value: string
  onChange: (next: string) => void
  disabled: boolean
}

function StepSecret({ blockId, value, onChange, disabled }: StepSecretProps) {
  const t = useTranslations('auto')
  return (
    <div className='space-y-4'>
      <SubStepList>
        <SubStep n={1}>
          {t('in_your_new_slack_app_open')} <strong>{t('basic_information')}</strong>.
        </SubStep>
        <SubStep n={2}>
          {t('find')} <strong>{t('signing_secret')}</strong> {t('and_click')}{' '}
          <strong>{t('show')}</strong>
          {t('then_copy_it')}
        </SubStep>
        <SubStep n={3}>{t('paste_it_into_the_field_below')}</SubStep>
      </SubStepList>
      <SecretField
        id={`${blockId}-wizard-signing-secret`}
        label={t('signing_secret')}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={t('paste_your_signing_secret_2')}
      />
    </div>
  )
}

interface StepTokenProps {
  blockId: string
  value: string
  onChange: (next: string) => void
  disabled: boolean
}

function StepToken({ blockId, value, onChange, disabled }: StepTokenProps) {
  const t = useTranslations('auto')
  return (
    <div className='space-y-4'>
      <SubStepList>
        <SubStep n={1}>
          {t('in_slack_open')} <strong>{t('install_app')}</strong> →{' '}
          <strong>{t('install_to_workspace')}</strong> {t('and_authorize')}
        </SubStep>
        <SubStep n={2}>
          {t('copy_the')} <strong>{t('bot_user_oauth_token')}</strong> {t('starts_with')}{' '}
          <code>{t('xoxb')}</code>).
        </SubStep>
        <SubStep n={3}>{t('paste_it_into_the_field_below')}</SubStep>
      </SubStepList>
      <SecretField
        id={`${blockId}-wizard-bot-token`}
        label={t('bot_token')}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={t('xoxb_2')}
      />
    </div>
  )
}

interface SecretFieldProps {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  disabled: boolean
  placeholder?: string
}

/**
 * Label + SecretInput pair used by the signing-secret and bot-token wizard
 * steps. The masked-on-blur behavior lives in the emcn `SecretInput`
 * primitive; this wrapper just pins the label/input composition the wizard
 * reuses twice.
 */
function SecretField({ id, label, value, onChange, disabled, placeholder }: SecretFieldProps) {
  return (
    <div className='space-y-1.5'>
      <Label htmlFor={id} className='font-medium text-[var(--text-secondary)] text-xs'>
        {label}
      </Label>
      <SecretInput
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        className='h-9 text-sm'
      />
    </div>
  )
}

interface StepDoneProps {
  hasSigningSecret: boolean
  hasBotToken: boolean
}

function StepDone({ hasSigningSecret, hasBotToken }: StepDoneProps) {
  const t = useTranslations('auto')
  return (
    <div className='space-y-4'>
      <p className='text-[var(--text-secondary)] text-sm leading-relaxed'>
        {t('your_slack_app_is_set_up')}
      </p>
      <div className='flex flex-col gap-2'>
        <StatusRow label={t('signing_secret')} ok={hasSigningSecret} />
        <StatusRow label={t('bot_token')} ok={hasBotToken} />
      </div>
      <p className='text-[var(--text-secondary)] text-sm'>
        {t('click_done_and_save_this_workflow')}
      </p>
    </div>
  )
}

interface StatusRowProps {
  label: string
  ok: boolean
}

function StatusRow({ label, ok }: StatusRowProps) {
  const t = useTranslations('auto')
  return (
    <span className='flex items-center gap-2'>
      <Check
        className={cn(
          'size-[14px]',
          ok ? 'text-[var(--text-success)]' : 'text-[var(--text-muted)]'
        )}
      />
      <span>
        {label}
        {!ok && <span className='ml-1 text-[var(--text-muted)]'>{t('not_saved_yet')}</span>}
      </span>
    </span>
  )
}

interface CapabilityGroupProps {
  blockId: string
  label: string
  capabilities: readonly SlackCapability[]
  selected: ReadonlySet<string>
  disabled: boolean
}

function CapabilityGroup({
  blockId,
  label,
  capabilities,
  selected,
  disabled,
}: CapabilityGroupProps) {
  return (
    <div className='space-y-2'>
      <div className='font-medium text-[var(--text-muted)] text-xs uppercase tracking-wide'>
        {label}
      </div>
      <div className='flex flex-col gap-y-2.5'>
        {capabilities.map((c) => (
          <CapabilityRow
            key={c.id}
            blockId={blockId}
            capability={c}
            checked={selected.has(c.id)}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  )
}

interface CapabilityRowProps {
  blockId: string
  capability: SlackCapability
  checked: boolean
  disabled: boolean
}

function CapabilityRow({ blockId, capability, checked, disabled }: CapabilityRowProps) {
  const [, setValue] = useSubBlockValue<boolean>(blockId, capability.id)
  const id = `${blockId}-wizard-${capability.id}`

  const handleChange = useCallback(
    (next: boolean) => {
      if (disabled) return
      setValue(next)
    },
    [disabled, setValue]
  )

  return (
    <div className='flex items-center gap-1.5'>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => handleChange(v === true)}
        disabled={disabled}
      />
      <Label
        htmlFor={id}
        className='cursor-pointer text-[var(--text-primary)] text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-60'
      >
        {capability.label}
      </Label>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Info className='size-[14px] cursor-default text-[var(--text-muted)]' />
        </Tooltip.Trigger>
        <Tooltip.Content side='top' align='start' className='max-w-xs'>
          <p>{capability.description}</p>
        </Tooltip.Content>
      </Tooltip.Root>
    </div>
  )
}

/**
 * Builds the set of enabled capability ids by reading each capability's
 * individual sub-block value in a single shallow-compared store selector.
 * A `null`/`undefined` store value falls back to the capability's
 * `defaultChecked` so untouched configs still reflect the defaults.
 */
function useCapabilitySelection(blockId: string): ReadonlySet<string> {
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  const enabledFlags = useSubBlockStore(
    useShallow((state) => {
      const blockValues = activeWorkflowId
        ? state.workflowValues[activeWorkflowId]?.[blockId]
        : undefined
      return SLACK_CAPABILITIES.map((c) => {
        const raw = blockValues?.[c.id]
        return typeof raw === 'boolean' ? raw : c.defaultChecked
      })
    })
  )
  return useMemo(
    () => new Set(SLACK_CAPABILITIES.filter((_, i) => enabledFlags[i]).map((c) => c.id)),
    [enabledFlags]
  )
}
