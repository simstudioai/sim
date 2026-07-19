'use client'

import { createElement, useMemo, useState } from 'react'
import {
  ArrowRight,
  Button,
  ChevronDown,
  cn,
  Expandable,
  ExpandableContent,
  SecretInput,
  SecretReveal,
  Tooltip,
  toast,
} from '@sim/emcn'
import { useParams } from 'next/navigation'
import { ContextMentionIcon } from '@/components/chat/context-mention-icon'
import type {
  ContentSegment,
  CredentialTagData,
  CredentialTagType,
  FileTagData,
  MothershipErrorTagData,
  OptionsItemData,
  OptionsTagData,
  ParsedSpecialContent,
  QuestionItem,
  QuestionOption,
  QuestionTagData,
  QuestionType,
  RuntimeSpecialTagName,
  SecretInputScope,
  UsageUpgradeAction,
  UsageUpgradeTagData,
  WorkspaceResourceTagData,
  WorkspaceResourceTagType,
} from '@/components/chat/special-tags/parse'
import {
  CREDENTIAL_TAG_TYPES,
  parseFileTag,
  parseJsonTagBody,
  parseLastQuestionTag,
  parseQuestionTagBody,
  parseSpecialTags,
  parseTagAttributes,
  parseTextTagBody,
  QUESTION_TYPES,
  SECRET_INPUT_SCOPES,
  USAGE_UPGRADE_ACTIONS,
  WORKSPACE_RESOURCE_TAG_TYPES,
} from '@/components/chat/special-tags/parse'
import { useSession } from '@/lib/auth/auth-client'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { canonicalWorkspaceFilePath } from '@/lib/copilot/vfs/path-utils'
import { isSafeHttpUrl } from '@/lib/core/utils/urls'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import { QuestionDisplay } from '@/app/workspace/[workspaceId]/home/components/message-content/components/question'
import type {
  ChatMessageContext,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useWorkspaceCredential } from '@/hooks/queries/credentials'
import {
  usePersonalEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

/** Re-exported so this stays the single import site for tag parsing + rendering. */
export {
  CREDENTIAL_TAG_TYPES,
  QUESTION_TYPES,
  SECRET_INPUT_SCOPES,
  USAGE_UPGRADE_ACTIONS,
  WORKSPACE_RESOURCE_TAG_TYPES,
  parseFileTag,
  parseJsonTagBody,
  parseLastQuestionTag,
  parseQuestionTagBody,
  parseSpecialTags,
  parseTagAttributes,
  parseTextTagBody,
}
export type {
  ContentSegment,
  CredentialTagData,
  CredentialTagType,
  FileTagData,
  MothershipErrorTagData,
  OptionsItemData,
  OptionsTagData,
  ParsedSpecialContent,
  QuestionItem,
  QuestionOption,
  QuestionTagData,
  QuestionType,
  RuntimeSpecialTagName,
  SecretInputScope,
  UsageUpgradeAction,
  UsageUpgradeTagData,
  WorkspaceResourceTagData,
  WorkspaceResourceTagType,
}

interface SpecialTagsProps {
  segment: Exclude<ContentSegment, { type: 'text' }>
  /** Transcript-derived answers for this message's question card (renders the recap). */
  questionAnswers?: string[]
  onOptionSelect?: (id: string) => void
  onQuestionDismiss?: () => void
  onWorkspaceResourceSelect?: (resource: MothershipResource) => void
}

/**
 * Unified renderer for inline special tags: `<options>`, `<usage_upgrade>`, `<credential>`,
 * and `<workspace_resource>`.
 */
export function SpecialTags({
  segment,
  questionAnswers,
  onOptionSelect,
  onQuestionDismiss,
  onWorkspaceResourceSelect,
}: SpecialTagsProps) {
  switch (segment.type) {
    case 'thinking':
      return null
    case 'options':
      return <OptionsDisplay data={segment.data} onSelect={onOptionSelect} />
    case 'usage_upgrade':
      return <UsageUpgradeDisplay data={segment.data} />
    case 'credential':
      return <CredentialDisplay data={segment.data} />
    case 'mothership-error':
      return <MothershipErrorDisplay data={segment.data} />
    case 'workspace_resource':
      return <WorkspaceResourceDisplay data={segment.data} onSelect={onWorkspaceResourceSelect} />
    case 'question':
      return (
        <QuestionDisplay
          data={segment.data}
          answers={questionAnswers}
          onSelect={onOptionSelect}
          onDismiss={onQuestionDismiss}
        />
      )
    default:
      return null
  }
}

interface OptionsDisplayProps {
  data: OptionsTagData
  onSelect?: (id: string) => void
}

function OptionsDisplay({ data, onSelect }: OptionsDisplayProps) {
  const disabled = !onSelect
  const [collapsedByUser, setCollapsedByUser] = useState(false)
  // When interactive (not disabled), always expanded. When disabled, the user can toggle.
  const expanded = !disabled || !collapsedByUser
  const entries = Object.entries(data)

  if (entries.length === 0) return null

  return (
    <div>
      {disabled ? (
        <button
          type='button'
          onClick={() => setCollapsedByUser((prev) => !prev)}
          aria-expanded={expanded}
          className='flex items-center gap-2'
        >
          <span className='text-[var(--text-body)] text-sm'>Suggested follow-ups</span>
          <ChevronDown
            className={cn(
              'h-[7px] w-[9px] text-[var(--text-icon)] transition-transform duration-150',
              !expanded && '-rotate-90'
            )}
          />
        </button>
      ) : (
        <span className='text-[var(--text-body)] text-sm'>Suggested follow-ups</span>
      )}
      <Expandable expanded={expanded}>
        <ExpandableContent className='mt-1.5'>
          <div className='flex flex-col'>
            {entries.map(([key, value], i) => {
              const title = value.title

              return (
                <button
                  key={key}
                  type='button'
                  disabled={disabled}
                  onClick={() => onSelect?.(title)}
                  className={cn(
                    'flex items-center gap-2 border-[var(--divider)] px-2 py-2 text-left transition-colors',
                    disabled ? 'cursor-not-allowed' : 'hover-hover:bg-[var(--surface-5)]',
                    i > 0 && 'border-t'
                  )}
                >
                  <div className='flex size-[16px] flex-shrink-0 items-center justify-center'>
                    <span className='text-[var(--text-icon)] text-sm'>{i + 1}</span>
                  </div>
                  <span className='flex-1 text-[var(--text-body)] text-sm'>{title}</span>
                  <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
                </button>
              )
            })}
          </div>
        </ExpandableContent>
      </Expandable>
    </div>
  )
}

function fallbackWorkspaceResourceTitle(type: WorkspaceResourceTagType): string {
  switch (type) {
    case 'workflow':
      return 'Workflow'
    case 'table':
      return 'Table'
    case 'file':
      return 'File'
  }
}

function toMothershipResourceType(type: WorkspaceResourceTagType): MothershipResource['type'] {
  return type
}

function toChatMessageContext(data: WorkspaceResourceTagData, label: string): ChatMessageContext {
  switch (data.type) {
    case 'workflow':
      return { kind: 'workflow', label, workflowId: data.id ?? '' }
    case 'table':
      return { kind: 'table', label, tableId: data.id ?? '' }
    case 'file':
      return { kind: 'file', label, fileId: data.id ?? data.path ?? '' }
  }
}

export function WorkspaceResourceDisplay({
  data,
  onSelect,
}: {
  data: WorkspaceResourceTagData
  onSelect?: (resource: MothershipResource) => void
}) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: workflows = [] } = useWorkflows(workspaceId)
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const { data: knowledgeBases = [] } = useKnowledgeBasesQuery(workspaceId)

  const resource = useMemo<MothershipResource>(() => {
    const fileFromPath =
      data.type === 'file' && data.path
        ? files.find(
            (file) =>
              canonicalWorkspaceFilePath({ folderPath: file.folderPath, name: file.name }) ===
              data.path
          )
        : undefined
    const title =
      data.type === 'workflow'
        ? (workflows.find((workflow) => workflow.id === data.id)?.name ??
          fallbackWorkspaceResourceTitle(data.type))
        : data.type === 'table'
          ? (tables.find((table) => table.id === data.id)?.name ??
            fallbackWorkspaceResourceTitle(data.type))
          : data.type === 'file'
            ? (files.find((file) => file.id === data.id)?.name ??
              fileFromPath?.name ??
              data.title ??
              fallbackWorkspaceResourceTitle(data.type))
            : (knowledgeBases.find((knowledgeBase) => knowledgeBase.id === data.id)?.name ??
              fallbackWorkspaceResourceTitle(data.type))

    return {
      type: toMothershipResourceType(data.type),
      id: data.id ?? fileFromPath?.id ?? data.path ?? '',
      title,
      ...(data.type === 'file' && data.path ? { path: data.path } : {}),
    }
  }, [data.id, data.path, data.title, data.type, files, knowledgeBases, tables, workflows])

  const context = toChatMessageContext(data, resource.title)

  const mentionContent = (
    <>
      <ContextMentionIcon
        context={context}
        className='relative top-0.5 size-[12px] flex-shrink-0 text-[var(--text-icon)]'
      />
      {resource.title}
    </>
  )

  const classes =
    'inline-flex items-baseline gap-1 rounded-[5px] bg-[var(--surface-5)] px-[5px] align-baseline font-[inherit] text-[inherit] leading-[inherit]'

  if (!onSelect) {
    return <span className={classes}>{mentionContent}</span>
  }

  return (
    <button
      type='button'
      onClick={() => onSelect(resource)}
      className={cn(classes, 'cursor-pointer transition-colors hover-hover:bg-[var(--surface-6)]')}
    >
      {mentionContent}
    </button>
  )
}

function getCredentialIcon(provider: string): React.ComponentType<{ className?: string }> | null {
  const lower = provider.toLowerCase()

  const directMatch = OAUTH_PROVIDERS[lower]
  if (directMatch) return directMatch.icon

  for (const config of Object.values(OAUTH_PROVIDERS)) {
    if (config.name.toLowerCase() === lower) return config.icon
    for (const service of Object.values(config.services)) {
      if (service.name.toLowerCase() === lower) return service.icon
      if (service.providerId.toLowerCase() === lower) return service.icon
    }
  }

  return null
}

const LockIcon = (props: { className?: string }) => (
  <svg
    className={props.className}
    viewBox='0 0 16 16'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    <rect x='2' y='5' width='12' height='8' rx='1.5' stroke='currentColor' strokeWidth='1.3' />
    <path
      d='M5 5V3.5a3 3 0 1 1 6 0V5'
      stroke='currentColor'
      strokeWidth='1.3'
      strokeLinecap='round'
    />
    <circle cx='8' cy='9.5' r='1.25' fill='currentColor' />
  </svg>
)

/**
 * Inline "paste a secret" widget rendered for
 * `<credential>{"type":"secret_input","name":"OPENAI_API_KEY"}</credential>`.
 * Reuses the shared emcn SecretInput; the pasted value is saved straight to
 * workspace (default) or personal environment variables under `name` and never
 * flows back through the chat transcript.
 */
function SecretInputDisplay({ data }: { data: CredentialTagData }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const secretName = (data.name ?? '').trim()
  const scope: SecretInputScope = data.scope === 'personal' ? 'personal' : 'workspace'

  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)

  const upsertWorkspace = useUpsertWorkspaceEnvironment()
  const savePersonal = useSavePersonalEnvironment()
  const personalQuery = usePersonalEnvironment()
  const personalEnv = personalQuery.data
  const { canEdit } = useUserPermissionsContext()

  // Setting a workspace var needs write/admin (same gate as the secrets manager);
  // personal vars are the user's own, so any member may set them.
  const canManage = scope === 'personal' || canEdit

  const isSaving = upsertWorkspace.isPending || savePersonal.isPending
  // Personal saves replace the whole map, so block until existing vars are loaded.
  const personalReady = scope !== 'personal' || personalEnv !== undefined
  const canSave =
    canManage && secretName.length > 0 && value.trim().length > 0 && !isSaving && personalReady

  const handleSave = async () => {
    if (!canSave) return
    try {
      if (scope === 'personal') {
        // The personal POST replaces the whole map, so re-read the latest vars
        // right before merging — a stale snapshot would drop keys saved elsewhere.
        const { data: latest } = await personalQuery.refetch()
        const merged: Record<string, string> = {}
        for (const [key, entry] of Object.entries(latest ?? personalEnv ?? {}))
          merged[key] = entry.value
        merged[secretName] = value
        await savePersonal.mutateAsync({ variables: merged })
      } else {
        await upsertWorkspace.mutateAsync({ workspaceId, variables: { [secretName]: value } })
      }
      setValue('')
      setSaved(true)
      toast.success(`Saved ${secretName}`)
    } catch {
      toast.error(`Couldn't save ${secretName}. Please try again.`)
    }
  }

  if (!secretName) return null
  // Only confirm after the user saves via THIS widget. A fresh prompt always shows
  // the input so the user can set or override the key, even if it already exists.
  if (saved) return <SecretReveal redacted />
  if (!canManage) return null

  return (
    <SecretInput
      value={value}
      onChange={setValue}
      placeholder={`Paste ${secretName}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void handleSave()
        }
      }}
      endAdornment={
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              type='button'
              variant='quiet'
              className='size-[18px] rounded-sm p-0'
              onClick={() => void handleSave()}
              disabled={!canSave}
              aria-label='Save'
            >
              <ArrowRight className='size-[13px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>{isSaving ? 'Saving…' : 'Save'}</Tooltip.Content>
        </Tooltip.Root>
      }
    />
  )
}

function CredentialLinkDisplay({ data }: { data: CredentialTagData }) {
  const { canEdit } = useUserPermissionsContext()

  // A connect URL carrying a credentialId re-authorizes that existing
  // credential in place (reconnect) rather than creating a new one.
  const reconnectCredentialId = useMemo(() => {
    if (!data.value) return undefined
    try {
      return new URL(data.value).searchParams.get('credentialId') ?? undefined
    } catch {
      return undefined
    }
  }, [data.value])
  const { data: reconnectCredential } = useWorkspaceCredential(reconnectCredentialId)

  // Connecting a credential mutates the workspace — hide it from read-only members.
  if (!data.provider || !canEdit) return null
  // The connect link value comes from the streamed model output, so only
  // render it as a clickable link when it resolves to a real http(s) URL.
  if (!data.value || !isSafeHttpUrl(data.value)) return null
  const Icon = getCredentialIcon(data.provider) ?? LockIcon
  const integrationName =
    getServiceConfigByProviderId(data.provider)?.name ??
    OAUTH_PROVIDERS[data.provider.toLowerCase()]?.name ??
    data.provider
  const label = reconnectCredentialId
    ? `Reconnect ${reconnectCredential?.displayName ?? integrationName}`
    : `Connect ${integrationName}`
  return (
    <a
      href={data.value}
      target='_blank'
      rel='noopener noreferrer'
      className='flex items-center gap-2 rounded-2xl border border-[var(--border-1)] px-3 py-2.5 transition-colors hover-hover:bg-[var(--surface-5)]'
    >
      {createElement(Icon, { className: 'size-[16px] shrink-0' })}
      <span className='flex-1 text-[var(--text-body)] text-sm'>{label}</span>
      <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
    </a>
  )
}

function CredentialDisplay({ data }: { data: CredentialTagData }) {
  if (data.type === 'secret_input') {
    return <SecretInputDisplay data={data} />
  }

  if (data.type === 'link') {
    return <CredentialLinkDisplay data={data} />
  }

  if (data.type === 'sim_key') {
    // SecretReveal masks itself when there's no value, so a value-less tag (the
    // model's placeholder / persisted form) renders masked and a Sim-filled tag
    // reveals the key + copy button — no separate "redacted" flag needed.
    return <SecretReveal value={data.value} />
  }

  return null
}

function MothershipErrorDisplay({ data }: { data: MothershipErrorTagData }) {
  const detail = data.code ? `${data.message} (${data.code})` : data.message

  return <p className='text-[13px] text-[var(--text-secondary)] italic leading-[20px]'>{detail}</p>
}

function UsageUpgradeDisplay({ data }: { data: UsageUpgradeTagData }) {
  const { data: session } = useSession()
  const hostContext = useWorkspaceHostContext()
  const { getSettingsHref } = useSettingsNavigation()
  const settingsPath = getSettingsHref({ section: 'billing' })
  const buttonLabel = data.action === 'upgrade_plan' ? 'Upgrade Plan' : 'Increase Limit'
  const canManageBilling = canManageWorkspaceBilling(hostContext, session?.user?.id)
  const unavailableMessage = hostContext.hostOrganizationId
    ? 'Contact an organization admin to manage this workspace’s usage limits.'
    : 'Only the workspace owner can manage this workspace’s usage limits.'

  return (
    <div className='rounded-2xl border border-amber-300/40 bg-amber-50/50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-950/20'>
      <div className='flex items-center gap-2'>
        <svg
          className='size-4 shrink-0 text-amber-600 dark:text-amber-400'
          viewBox='0 0 16 16'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <path
            d='M8 1.5L1 14h14L8 1.5z'
            stroke='currentColor'
            strokeWidth='1.3'
            strokeLinejoin='round'
          />
          <path d='M8 6.5v3' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round' />
          <circle cx='8' cy='11.5' r='0.75' fill='currentColor' />
        </svg>
        <span className='font-[500] text-amber-800 text-sm leading-5 dark:text-amber-300'>
          Usage Limit Reached
        </span>
      </div>
      <p className='mt-1.5 text-amber-700/90 text-small leading-[20px] dark:text-amber-400/80'>
        {data.message}
      </p>
      {canManageBilling ? (
        <a
          href={settingsPath}
          className='mt-2 inline-flex items-center gap-1 font-[500] text-amber-700 text-small underline decoration-dashed underline-offset-2 transition-colors hover-hover:text-amber-900 dark:text-amber-300 dark:hover-hover:text-amber-200'
        >
          {buttonLabel}
          <ArrowRight className='size-3' />
        </a>
      ) : (
        <p className='mt-2 font-[500] text-amber-700 text-small dark:text-amber-300'>
          {unavailableMessage}
        </p>
      )}
    </div>
  )
}
