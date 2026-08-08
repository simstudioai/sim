'use client'

import { createElement, lazy, Suspense, useMemo, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  cn,
  Expandable,
  ExpandableContent,
  SecretReveal,
  SquareArrowUpRight,
  Tooltip,
  toast,
} from '@sim/emcn'
import { Cursor, TerminalWindow } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
import { ContextMentionIcon } from '@/components/chat/context-mention-icon'
import {
  type ContentSegment,
  type CredentialItemData,
  type CredentialSubmissionPayload,
  type CredentialTagData,
  type CredentialTagType,
  formatCredentialSubmissionMessage,
  type MothershipErrorTagData,
  type OptionsTagData,
  type SecretInputScope,
  type UsageUpgradeTagData,
  type WorkspaceResourceTagData,
  type WorkspaceResourceTagType,
} from '@/components/chat/special-tags/parse'
import { ThinkingLoader } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { buildHostedUpgradeUrl, HOSTED_BILLING_SETTINGS_URL } from '@/lib/billing/upgrade-reasons'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { isBrowserAgentAvailable, sendBrowserPanelAction } from '@/lib/browser-agent/transport'
import { isHosted } from '@/lib/core/config/env-flags'
import { isSafeHttpUrl } from '@/lib/core/utils/urls'
import { getDesktopBridge } from '@/lib/desktop'
import { desktopChatScopeId } from '@/lib/desktop/chat-scope'
import {
  resolveOAuthServiceForSlug,
  resolveServiceAccountIntegration,
} from '@/lib/integrations/oauth-service'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import { finishTerminalHandoff, isTerminalAvailable } from '@/lib/terminal/transport'
import { useChatSurface } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import {
  INTERACTION_CARD_ROW_CLASSES,
  InteractionCard,
  InteractionCardActionRow,
  InteractionCardInputRow,
  InteractionCardRecap,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/interaction-card'
import { QuestionDisplay } from '@/app/workspace/[workspaceId]/home/components/message-content/components/question'
import { useOAuthChipConnection } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/use-oauth-chip-connection'
import type {
  ChatMessageContext,
  MothershipResource,
  WorkspaceResourceRef,
} from '@/app/workspace/[workspaceId]/home/types'
// Deep import, not the barrel: the barrel also re-exports
// ConnectServiceAccountModal, and that edge would pull the modal into this
// chunk and defeat the lazy() split below.
import { useServiceAccountConnectTarget } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/use-service-account-connect'
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
import { findWorkspaceFileByPath } from '@/hooks/queries/utils/find-workspace-file-by-src'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

const ConnectServiceAccountModal = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/connect-service-account-modal'
  ).then((m) => ({ default: m.ConnectServiceAccountModal }))
)

interface SpecialTagsProps {
  segment: Exclude<ContentSegment, { type: 'text' }>
  /** Stable identity for interaction state owned by this message/tag. */
  interactionId?: string
  /** Transcript-derived answers for this message's question card (renders the recap). */
  questionAnswers?: string[]
  /** Transcript-derived status payload for this message's credential card. */
  credentialSubmission?: CredentialSubmissionPayload
  onOptionSelect?: (id: string) => void
  onQuestionDismiss?: () => void
  onWorkspaceResourceSelect?: (resource: WorkspaceResourceRef) => void
}

/**
 * Unified renderer for inline special tags: `<options>`, `<usage_upgrade>`, `<credential>`,
 * and `<workspace_resource>`.
 */
export function SpecialTags({
  segment,
  interactionId,
  questionAnswers,
  credentialSubmission,
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
      return (
        <CredentialDisplay
          data={segment.data}
          interactionId={interactionId}
          submitted={credentialSubmission}
          onContinue={onOptionSelect}
        />
      )
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

interface PendingTagIndicatorProps {
  /** Activity phrase next to the loader; crossfades on change. */
  label: string
}

/**
 * Renders the turn-level activity shimmer.
 */
export function PendingTagIndicator({ label }: PendingTagIndicatorProps) {
  return (
    <div className='animate-stream-fade-in py-2'>
      <ThinkingLoader size={20} startVariant='corners' label={label} labelRatio={0.7} />
    </div>
  )
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
              'size-[14px] text-[var(--text-icon)] transition-transform duration-150',
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
                    'flex items-center gap-2 border-[var(--border)] px-2 py-2 text-left transition-colors',
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
  onSelect?: (resource: WorkspaceResourceRef) => void
}) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: workflows = [] } = useWorkflows(workspaceId)
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const { data: knowledgeBases = [] } = useKnowledgeBasesQuery(workspaceId)

  const resource = useMemo<WorkspaceResourceRef>(() => {
    const fileFromPath =
      data.type === 'file' ? findWorkspaceFileByPath(files, data.path) : undefined
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

    const id = data.id ?? fileFromPath?.id
    return {
      type: toMothershipResourceType(data.type),
      ...(id ? { id } : {}),
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

function getCredentialProviderDisplayName(provider: string): string {
  return (
    getServiceConfigByProviderId(provider)?.name ??
    OAUTH_PROVIDERS[provider.toLowerCase()]?.name ??
    provider
  )
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
interface CredentialControlProps {
  data: CredentialItemData
  controlId?: string
  embedded?: boolean
  divided?: boolean
  secretValue?: string
  onSecretValueChange?: (value: string) => void
  onSaved?: () => void
  onConnected?: () => void
}

function SecretInputDisplay({ data, divided = false, onSaved }: CredentialControlProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const secretName = (data.name ?? '').trim()
  const scope: SecretInputScope = data.scope === 'personal' ? 'personal' : 'workspace'

  const [value, setValue] = useState('')
  const [isFocused, setIsFocused] = useState(false)
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
      onSaved?.()
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
    <InteractionCardInputRow
      divided={divided}
      type='text'
      value={isFocused ? value : '•'.repeat(value.length)}
      placeholder={`Paste ${secretName}`}
      autoComplete='off'
      aria-label={secretName}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onChange={(event) => {
        if (isFocused) setValue(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.currentTarget.blur()
          return
        }
        if (event.key === 'Enter' && canSave) {
          event.preventDefault()
          void handleSave()
        }
      }}
      trailing={
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type='button'
              onClick={() => void handleSave()}
              disabled={!canSave}
              aria-label='Save'
              className='disabled:cursor-default'
            >
              <ArrowRight
                className={cn(
                  'size-[16px] shrink-0 transition-colors',
                  canSave ? 'text-[var(--text-body)]' : 'text-[var(--text-icon)]'
                )}
              />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>{isSaving ? 'Saving…' : 'Save'}</Tooltip.Content>
        </Tooltip.Root>
      }
    />
  )
}

interface CredentialSecretInputRowProps {
  name: string
  value: string
  divided?: boolean
  onChange: (value: string) => void
}

/** Secret draft field for the unified card; the card's final Submit owns persistence. */
function CredentialSecretInputRow({
  name,
  value,
  divided = false,
  onChange,
}: CredentialSecretInputRowProps) {
  const [isFocused, setIsFocused] = useState(false)

  return (
    <InteractionCardInputRow
      divided={divided}
      type='text'
      value={isFocused ? value : '•'.repeat(value.length)}
      placeholder={`Paste ${name}`}
      autoComplete='off'
      aria-label={name}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onChange={(event) => {
        const maskedValue = '•'.repeat(value.length)
        if (isFocused || event.target.value !== maskedValue) onChange(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.currentTarget.blur()
      }}
    />
  )
}

/**
 * Folder icon for the local-folder grant chip (matches the credential chip
 * icon sizing).
 */
const FolderGrantIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <path
      d='M1.5 4.5A1.5 1.5 0 0 1 3 3h3.2l1.6 1.8H13A1.5 1.5 0 0 1 14.5 6.3v5.2A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5v-7z'
      stroke='currentColor'
      strokeWidth='1.2'
      strokeLinejoin='round'
    />
  </svg>
)

/**
 * Inline grant chip rendered for
 * `<credential>{"type":"folder_access","name":"Desktop"}</credential>`.
 * Clicking opens the desktop app's native folder picker (read-only grant,
 * same flow as the Desktop settings folder picker). Renders nothing outside the
 * desktop app — there is no local filesystem bridge to grant against.
 */
function FolderAccessDisplay({ data }: { data: CredentialItemData }) {
  const [picking, setPicking] = useState(false)
  const [grantedName, setGrantedName] = useState<string | null>(null)

  const bridge = getDesktopBridge()
  if (!bridge?.localFilesystem) return null

  const hint = (data.name ?? '').trim()
  const label = grantedName
    ? `Access granted — ${grantedName}`
    : hint
      ? `Grant access to ${hint}`
      : 'Grant access to a local folder'

  const handleClick = async () => {
    if (picking || grantedName) return
    setPicking(true)
    try {
      const response = await bridge.localFilesystem({ operation: 'mount_directory' })
      if (response.ok && 'mount' in response.data && response.data.mount) {
        setGrantedName(response.data.mount.name)
        toast.success(`Granted access to ${response.data.mount.name}`)
      }
    } catch {
      toast.error("Couldn't open the folder picker. Please try again.")
    } finally {
      setPicking(false)
    }
  }

  return (
    <button
      type='button'
      onClick={() => void handleClick()}
      disabled={picking || grantedName !== null}
      className={cn(
        'flex w-full items-center gap-2 rounded-2xl border border-[var(--border-1)] px-3 py-2.5 text-left transition-colors',
        grantedName === null && !picking && 'hover-hover:bg-[var(--surface-5)]',
        picking && 'opacity-60'
      )}
    >
      <FolderGrantIcon className='size-[16px] shrink-0' />
      <span className='flex-1 text-[var(--text-body)] text-sm'>
        {picking ? 'Choose a folder…' : label}
      </span>
      {grantedName === null && (
        <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
      )}
    </button>
  )
}

/**
 * Inline hand-back chip rendered while `browser_request_takeover` waits on
 * the user (`{"type":"browser_takeover","name":"Please sign in to LinkedIn"}`).
 * Same chip as the other credential actions; clicking hands control of the
 * agent browser back to Sim. Renders nothing outside the desktop app — there
 * is no agent browser to hand back.
 */
function BrowserTakeoverDisplay({ data }: { data: CredentialItemData }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { chatId } = useChatSurface()
  const [handedBack, setHandedBack] = useState(false)

  if (!isBrowserAgentAvailable()) return null

  const reason = (data.name ?? '').trim()
  const label = handedBack
    ? 'Handed control back to Sim'
    : reason || 'Take over in the browser, then hand control back'

  return (
    <button
      type='button'
      onClick={() => {
        if (handedBack) return
        setHandedBack(true)
        sendBrowserPanelAction('takeover-done', {}, desktopChatScopeId(workspaceId, chatId))
      }}
      disabled={handedBack}
      className={cn(
        'flex w-full items-center gap-2 rounded-2xl border border-[var(--border-1)] px-3 py-2.5 text-left transition-colors',
        !handedBack && 'hover-hover:bg-[var(--surface-5)]'
      )}
    >
      <Cursor className='size-[16px] shrink-0' />
      <span className='flex-1 text-[var(--text-body)] text-sm'>{label}</span>
      {!handedBack && <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />}
    </button>
  )
}

/**
 * Inline "set up a service account" control rendered for
 * `<credential>{"type":"service_account","provider":"slack"}</credential>`.
 *
 * Opens `ConnectServiceAccountModal` over the chat rather than linking out to
 * the integrations page — the user stays in the conversation that asked for
 * the credential, and comes back to it with the credential in hand.
 */
function ServiceAccountConnectDisplay({
  data,
  embedded = false,
  divided = false,
  onConnected,
}: CredentialControlProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { canEdit } = useUserPermissionsContext()
  const [open, setOpen] = useState(false)
  const [locallyConnected, setLocallyConnected] = useState(false)

  const match = useMemo(
    () => (data.provider ? resolveServiceAccountIntegration(data.provider) : null),
    [data.provider]
  )
  const service = useMemo(() => (match ? resolveOAuthServiceForSlug(match.slug) : null), [match])
  const target = useServiceAccountConnectTarget({
    serviceAccountProviderId: match?.serviceAccountProviderId,
    serviceName: match?.serviceName,
    serviceIcon: service?.serviceIcon,
  })

  // A credentialId reconnects (rotates the secret on) that existing service
  // account in place rather than creating a new one — the modal keeps its id.
  const reconnectCredentialId = data.credentialId
  const { data: reconnectCredential } = useWorkspaceCredential(reconnectCredentialId)
  const connected = locallyConnected

  // Creating a credential mutates the workspace — hide it from read-only
  // members, and honour the provider's own preview gate (custom Slack bots
  // ride the slack_v2 flag) so chat can't surface what the integrations page
  // deliberately hides.
  if (!target || target.hidden || !canEdit || !workspaceId) return null

  const label = reconnectCredentialId
    ? `Reconnect ${reconnectCredential?.displayName ?? target.serviceName}`
    : `${target.label} for ${target.serviceName}`
  const displayLabel = connected ? `Connected ${target.serviceName}` : label

  return (
    <>
      <button
        type='button'
        onClick={() => {
          if (!connected) setOpen(true)
        }}
        disabled={connected}
        className={cn(
          embedded
            ? INTERACTION_CARD_ROW_CLASSES
            : 'flex w-full items-center gap-2 rounded-2xl border border-[var(--border-1)] px-3 py-2.5 text-left transition-colors',
          embedded && divided && 'border-t',
          'hover-hover:bg-[var(--surface-5)]'
        )}
      >
        {createElement(target.serviceIcon, { className: 'size-[16px] shrink-0' })}
        <span className='flex-1 text-[var(--text-body)] text-sm'>{displayLabel}</span>
        {connected ? (
          <Check className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        ) : (
          <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        )}
      </button>
      {open && (
        <Suspense fallback={null}>
          <ConnectServiceAccountModal
            open={open}
            onOpenChange={setOpen}
            workspaceId={workspaceId}
            serviceAccountProviderId={target.serviceAccountProviderId}
            serviceName={target.serviceName}
            serviceIcon={target.serviceIcon}
            credentialId={reconnectCredentialId}
            credentialDisplayName={reconnectCredential?.displayName ?? undefined}
            onCreated={() => {
              setLocallyConnected(true)
              onConnected?.()
            }}
          />
        </Suspense>
      )}
    </>
  )
}

function CredentialLinkDisplay({
  data,
  controlId = 'credential-link',
  embedded = false,
  divided = false,
  onConnected,
}: CredentialControlProps) {
  const { canEdit } = useUserPermissionsContext()
  const integrationName = getCredentialProviderDisplayName(data.provider ?? '')
  const {
    reconnectCredentialId,
    status,
    connected,
    connectedFromAttempt,
    hasExistingCredential,
    isReady,
    onConnectClick,
  } = useOAuthChipConnection({
    connectUrl: data.value,
    provider: data.provider,
    displayName: integrationName,
    controlId,
    onConnected,
  })
  const { data: reconnectCredential } = useWorkspaceCredential(reconnectCredentialId)

  // Connecting a credential mutates the workspace — hide it from read-only members.
  if (!data.provider || !canEdit) return null
  // The connect link value comes from the streamed model output, so only
  // render it as a clickable link when it resolves to a real http(s) URL.
  if (!data.value || !isSafeHttpUrl(data.value)) return null
  const Icon = getCredentialIcon(data.provider) ?? LockIcon
  const label = reconnectCredentialId
    ? `Reconnect ${reconnectCredential?.displayName ?? integrationName}`
    : hasExistingCredential
      ? `Connect another ${integrationName}`
      : `Connect ${integrationName}`
  const retryLabel = reconnectCredentialId
    ? `Not connected — reconnect ${reconnectCredential?.displayName ?? integrationName}`
    : hasExistingCredential
      ? `Not connected — connect another ${integrationName}`
      : `Not connected — connect ${integrationName}`
  const displayLabel = connected
    ? `Connected ${integrationName}`
    : !isReady
      ? `Checking ${integrationName} connections…`
      : status === 'pending'
        ? `Waiting for ${integrationName} connection…`
        : status === 'failed'
          ? retryLabel
          : label

  return (
    <a
      href={data.value}
      target='_blank'
      rel='noopener noreferrer'
      onClick={onConnectClick}
      aria-disabled={!isReady || connectedFromAttempt}
      className={cn(
        embedded
          ? INTERACTION_CARD_ROW_CLASSES
          : 'flex items-center gap-2 rounded-2xl border border-[var(--border-1)] px-3 py-2.5 transition-colors',
        embedded && divided && 'border-t',
        'hover-hover:bg-[var(--surface-5)]'
      )}
    >
      {createElement(Icon, { className: 'size-[16px] shrink-0' })}
      <span className='flex-1 text-[var(--text-body)] text-sm'>{displayLabel}</span>
      {connected ? (
        <Check className='size-[16px] shrink-0 text-[var(--text-icon)]' />
      ) : (
        <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
      )}
    </a>
  )
}

/**
 * Inline hand-back chip rendered while a terminal handoff waits on the user —
 * a command sitting on a prompt only they can answer. Without it the tool row
 * just spins: the command is blocked in a panel the user may not even be
 * looking at, with nothing saying it wants them. Clicking tells the waiting
 * handoff they are done; the terminal id rides in `value` so the click reaches
 * the right shell. Renders nothing outside the desktop app.
 */
function TerminalHandoffDisplay({ data }: { data: CredentialItemData }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { chatId } = useChatSurface()
  const [handedBack, setHandedBack] = useState(false)

  if (!isTerminalAvailable()) return null

  const reason = (data.name ?? '').trim()
  const label = handedBack
    ? 'Handed control back to Sim'
    : reason || 'Finish in the terminal, then hand control back'

  return (
    <button
      type='button'
      onClick={() => {
        if (handedBack) return
        setHandedBack(true)
        finishTerminalHandoff(data.value ?? '', desktopChatScopeId(workspaceId, chatId))
      }}
      disabled={handedBack}
      className={cn(
        'flex w-full items-center gap-2 rounded-2xl border border-[var(--border-1)] px-3 py-2.5 text-left transition-colors',
        !handedBack && 'hover-hover:bg-[var(--surface-5)]'
      )}
    >
      <TerminalWindow className='size-[16px] shrink-0' />
      <span className='flex-1 text-[var(--text-body)] text-sm'>{label}</span>
      {!handedBack && <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />}
    </button>
  )
}

const CREDENTIAL_CARD_TYPES: ReadonlySet<CredentialTagType> = new Set([
  'secret_input',
  'link',
  'service_account',
  'sim_key',
])

function isCredentialCardItemVisible(item: CredentialItemData, canEdit: boolean): boolean {
  if (item.type === 'sim_key') return true
  if (item.type === 'secret_input') return item.scope === 'personal' || canEdit
  if (item.type === 'link') {
    return canEdit && Boolean(item.provider) && Boolean(item.value && isSafeHttpUrl(item.value))
  }
  return canEdit
}

/** Whether a terminal credential tag produces the shared question-style card. */

function CredentialItemDisplay({
  data,
  controlId,
  embedded = false,
  divided = false,
  secretValue,
  onSecretValueChange,
  onSaved,
  onConnected,
}: CredentialControlProps) {
  if (data.type === 'secret_input') {
    const secretName = data.name?.trim()
    if (embedded) {
      if (!secretName || !onSecretValueChange) return null
      return (
        <CredentialSecretInputRow
          name={secretName}
          value={secretValue ?? ''}
          divided={divided}
          onChange={onSecretValueChange}
        />
      )
    }
    return (
      <SecretInputDisplay data={data} embedded={embedded} divided={divided} onSaved={onSaved} />
    )
  }

  if (data.type === 'folder_access') {
    return <FolderAccessDisplay data={data} />
  }

  if (data.type === 'browser_takeover') {
    return <BrowserTakeoverDisplay data={data} />
  }

  if (data.type === 'terminal_handoff') {
    return <TerminalHandoffDisplay data={data} />
  }

  if (data.type === 'link') {
    return (
      <CredentialLinkDisplay
        data={data}
        controlId={controlId}
        embedded={embedded}
        divided={divided}
        onConnected={onConnected}
      />
    )
  }

  if (data.type === 'service_account') {
    return (
      <ServiceAccountConnectDisplay
        data={data}
        embedded={embedded}
        divided={divided}
        onConnected={onConnected}
      />
    )
  }

  if (data.type === 'sim_key') {
    // SecretReveal masks itself when there's no value, so a value-less tag (the
    // model's placeholder / persisted form) renders masked and a Sim-filled tag
    // reveals the key + copy button — no separate "redacted" flag needed.
    return <SecretReveal value={data.value} />
  }

  return null
}

/**
 * Credential input and OAuth controls use the same InteractionCard primitives
 * as QuestionDisplay. Integrations come first and secrets follow in one card
 * with one Submit; legacy/system actions retain their standalone presentation.
 */
function CredentialInputCard({
  data,
  interactionId,
  submitted,
  onContinue,
}: {
  data: CredentialTagData
  interactionId?: string
  submitted?: CredentialSubmissionPayload
  onContinue?: (message: string) => void
}) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { canEdit } = useUserPermissionsContext()
  const upsertWorkspace = useUpsertWorkspaceEnvironment()
  const savePersonal = useSavePersonalEnvironment()
  const personalQuery = usePersonalEnvironment()
  const [secretDrafts, setSecretDrafts] = useState<Record<number, string>>({})
  const [savedSecretRows, setSavedSecretRows] = useState<Set<number>>(() => new Set())
  const [connectedIntegrationRows, setConnectedIntegrationRows] = useState<Set<number>>(
    () => new Set()
  )
  const [locallySubmitted, setLocallySubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  let integrationIndex = 0
  let secretIndex = 0
  const indexedRows = data.map((item, dataIndex) => ({
    item,
    dataIndex,
    integrationIndex:
      item.type === 'link' || item.type === 'service_account' ? integrationIndex++ : undefined,
    secretIndex: item.type === 'secret_input' ? secretIndex++ : undefined,
  }))
  const visibleRows = indexedRows.filter(({ item }) => isCredentialCardItemVisible(item, canEdit))
  if (visibleRows.length === 0) return null

  const integrationRows = visibleRows.filter(
    ({ item }) => item.type === 'link' || item.type === 'service_account'
  )
  const secretRows = visibleRows.filter(
    ({ item }) => item.type === 'secret_input' || item.type === 'sim_key'
  )
  const requiredSecretRows = secretRows.filter(({ item }) => item.type === 'secret_input')
  const title =
    integrationRows.length > 0 && secretRows.length > 0
      ? 'Set up credentials'
      : integrationRows.length > 0
        ? 'Connect integrations'
        : requiredSecretRows.length > 0
          ? 'Add secrets'
          : 'API key'
  const rows = [
    ...integrationRows.map(({ item, dataIndex, integrationIndex }, index) => (
      <CredentialItemDisplay
        key={`${item.type}-${item.provider ?? dataIndex}-${dataIndex}`}
        data={item}
        controlId={`${interactionId ?? 'credential-card'}:${dataIndex}`}
        embedded
        divided={index > 0}
        onConnected={() =>
          setConnectedIntegrationRows((current) => {
            if (integrationIndex === undefined || current.has(integrationIndex)) return current
            const next = new Set(current)
            next.add(integrationIndex)
            return next
          })
        }
      />
    )),
    ...secretRows.map(({ item, dataIndex, secretIndex }, index) => {
      return (
        <CredentialItemDisplay
          key={`${item.type}-${item.name ?? dataIndex}-${dataIndex}`}
          data={item}
          embedded
          divided={integrationRows.length > 0 || index > 0}
          secretValue={
            item.type === 'secret_input' ? (secretDrafts[secretIndex ?? -1] ?? '') : undefined
          }
          onSecretValueChange={
            item.type === 'secret_input' && secretIndex !== undefined
              ? (value) =>
                  setSecretDrafts((current) => ({
                    ...current,
                    [secretIndex]: value,
                  }))
              : undefined
          }
        />
      )
    }),
  ]

  const submitCredentialSetup = async (): Promise<boolean> => {
    if (!onContinue) return false

    const workspaceVariables: Record<string, string> = {}
    const personalVariables: Record<string, string> = {}
    const enteredSecretIndexes: number[] = []

    for (const { item, secretIndex } of requiredSecretRows) {
      if (secretIndex === undefined) continue
      const name = item.name?.trim()
      const value = secretDrafts[secretIndex] ?? ''
      if (!name || value.trim().length === 0) continue
      const target = item.scope === 'personal' ? personalVariables : workspaceVariables
      target[name] = value
      enteredSecretIndexes.push(secretIndex)
    }

    try {
      const saves: Promise<unknown>[] = []
      if (Object.keys(workspaceVariables).length > 0) {
        saves.push(upsertWorkspace.mutateAsync({ workspaceId, variables: workspaceVariables }))
      }
      if (Object.keys(personalVariables).length > 0) {
        saves.push(
          (async () => {
            const { data: latest } = await personalQuery.refetch()
            const merged: Record<string, string> = {}
            for (const [key, entry] of Object.entries(latest ?? personalQuery.data ?? {})) {
              merged[key] = entry.value
            }
            Object.assign(merged, personalVariables)
            await savePersonal.mutateAsync({ variables: merged })
          })()
        )
      }
      await Promise.all(saves)
    } catch {
      toast.error(`Couldn't save secrets. Please try again.`)
      return false
    }

    const nextSavedSecretRows = new Set(savedSecretRows)
    for (const index of enteredSecretIndexes) nextSavedSecretRows.add(index)
    setSavedSecretRows(nextSavedSecretRows)

    onContinue(
      formatCredentialSubmissionMessage(data, {
        connectedIntegrationIndexes: connectedIntegrationRows,
        savedSecretIndexes: nextSavedSecretRows,
      })
    )
    return true
  }

  const needsContinuation = integrationRows.length > 0 || requiredSecretRows.length > 0
  const credentialSummary = [
    ...integrationRows.map(({ item, integrationIndex }) => ({
      label: getCredentialProviderDisplayName(item.provider ?? 'Integration'),
      status: (
        submitted
          ? submitted.integrations[integrationIndex ?? -1]?.status === 'connected'
          : connectedIntegrationRows.has(integrationIndex ?? -1)
      )
        ? ('Connected' as const)
        : ('Skipped' as const),
    })),
    ...secretRows.map(({ item, secretIndex }) => {
      if (item.type === 'sim_key') {
        return { label: item.name ?? 'Sim API key', status: 'Added' as const }
      }
      const saved = submitted
        ? submitted.secrets[secretIndex ?? -1]?.status === 'saved'
        : savedSecretRows.has(secretIndex ?? -1)
      return {
        label: item.name ?? 'Secret',
        status: saved ? ('Added' as const) : ('Skipped' as const),
      }
    }),
  ]

  if (submitted || locallySubmitted) {
    return (
      <InteractionCardRecap
        items={credentialSummary.map((item) => ({ label: item.label, values: [item.status] }))}
      />
    )
  }

  const handleSubmit = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      if (await submitCredentialSetup()) setLocallySubmitted(true)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <InteractionCard title={title}>
      <div className='flex flex-col'>
        {rows}
        {needsContinuation && onContinue && (
          <InteractionCardActionRow
            label='Submit'
            disabled={isSubmitting}
            onClick={() => void handleSubmit()}
          />
        )}
      </div>
    </InteractionCard>
  )
}

export function CredentialDisplay({
  data,
  interactionId,
  submitted,
  onContinue,
}: {
  data: CredentialTagData
  interactionId?: string
  submitted?: CredentialSubmissionPayload
  onContinue?: (message: string) => void
}) {
  const usesCredentialCard = data.every((item) => CREDENTIAL_CARD_TYPES.has(item.type))

  if (usesCredentialCard) {
    return (
      <CredentialInputCard
        data={data}
        interactionId={interactionId}
        submitted={submitted}
        onContinue={onContinue}
      />
    )
  }

  return (
    <div className={cn(data.length > 1 && 'space-y-3')}>
      {data.map((item, index) => (
        <CredentialItemDisplay
          key={`${item.type}-${item.provider ?? item.name ?? index}`}
          data={item}
        />
      ))}
    </div>
  )
}

function MothershipErrorDisplay({ data }: { data: MothershipErrorTagData }) {
  const detail = data.code ? `${data.message} (${data.code})` : data.message

  return <p className='text-[13px] text-[var(--text-secondary)] italic leading-[20px]'>{detail}</p>
}

function UsageUpgradeDisplay({ data }: { data: UsageUpgradeTagData }) {
  const { data: session } = useSession()
  const hostContext = useWorkspaceHostContext()
  const { getSettingsHref } = useSettingsNavigation()
  const buttonLabel = data.action === 'upgrade_plan' ? 'Upgrade Plan' : 'Increase Limit'

  // Self-hosted plan and limit both live on the hosted account, so local
  // workspace billing roles say nothing about who may change them.
  const href = isHosted
    ? getSettingsHref({ section: 'billing' })
    : data.action === 'upgrade_plan'
      ? buildHostedUpgradeUrl()
      : HOSTED_BILLING_SETTINGS_URL
  const canManageBilling = !isHosted || canManageWorkspaceBilling(hostContext, session?.user?.id)
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
        <span className='font-medium text-amber-800 text-sm leading-5 dark:text-amber-300'>
          Usage Limit Reached
        </span>
      </div>
      <p className='mt-1.5 text-amber-700/90 text-small leading-[20px] dark:text-amber-400/80'>
        {data.message}
      </p>
      {canManageBilling ? (
        <a
          href={href}
          target={isHosted ? undefined : '_blank'}
          rel={isHosted ? undefined : 'noopener noreferrer'}
          aria-label={isHosted ? undefined : `${buttonLabel} (opens in a new tab)`}
          className='mt-2 inline-flex items-center gap-1 font-medium text-amber-700 text-small underline decoration-dashed underline-offset-2 transition-colors hover-hover:text-amber-900 dark:text-amber-300 dark:hover-hover:text-amber-200'
        >
          {buttonLabel}
          {isHosted ? <ArrowRight className='size-3' /> : <SquareArrowUpRight className='size-3' />}
        </a>
      ) : (
        <p className='mt-2 font-medium text-amber-700 text-small dark:text-amber-300'>
          {unavailableMessage}
        </p>
      )}
    </div>
  )
}
