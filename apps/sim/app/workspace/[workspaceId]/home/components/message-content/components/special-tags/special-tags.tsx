'use client'

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ChipLink,
  cn,
  Expandable,
  ExpandableContent,
  SecretReveal,
  Tooltip,
  toast,
} from '@sim/emcn-legacy'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Lock,
  SquareArrowUpRight,
  TerminalWindow,
  TriangleAlert,
} from '@sim/emcn-legacy/icons'
import { omit } from '@sim/utils/object'
import { useParams } from 'next/navigation'
import { useSession } from '@/lib/auth/client'
import { CHAT_PLAN_REQUIRED_REASON } from '@/lib/billing/chat-plan'
import { isBrowserAgentAvailable, sendBrowserPanelAction } from '@/lib/browser-agent/transport'
import { isSafeHttpUrl } from '@/lib/core/utils/urls'
import { readLatestOAuthChatAttempt } from '@/lib/credentials/oauth-chat-attempt'
import { getDesktopBridge } from '@/lib/desktop'
import { desktopChatScopeId } from '@/lib/desktop/chat-scope'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'
import {
  resolveOAuthServiceForSlug,
  resolveServiceAccountIntegration,
} from '@/lib/integrations/oauth-service'
import {
  readSearchConnectionAttempt,
  searchConnectionAttemptKey,
} from '@/lib/knowledge/search/connection-attempt'
import { searchConnectionTargetSchema } from '@/lib/knowledge/search/connection-target'
import {
  type ContentSegment,
  type CredentialItemData,
  type CredentialSubmissionPayload,
  type CredentialTagData,
  type CredentialTagType,
  formatCredentialSubmissionMessage,
  type MothershipErrorTagData,
  type OptionsTagData,
  type QuestionItem,
  type SecretInputScope,
  type UsageUpgradeTagData,
  type WorkspaceResourceTagData,
  type WorkspaceResourceTagType,
} from '@/lib/mothership/chat/special-tags'
import type {
  ChatMessageContext,
  MothershipResource,
  WorkspaceResourceRef,
} from '@/lib/mothership/chat/types'
import { rememberSettingsReturnUrl } from '@/lib/navigation/settings-return'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import { finishTerminalHandoff, isTerminalAvailable } from '@/lib/terminal/transport'
import { useChatSurface } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import { ContextMentionIcon } from '@/app/workspace/[workspaceId]/home/components/context-mention-icon'
import {
  INTERACTION_CARD_ROW_CLASSES,
  InteractionCard,
  InteractionCardActionRow,
  InteractionCardInputRow,
  InteractionCardRecap,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/interaction-card'
import {
  parseQuestionAnswerMessage,
  QuestionDisplay,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/question'
import { ResourceMention } from '@/app/workspace/[workspaceId]/home/components/message-content/components/resource-mention'
import {
  CredentialWorkspaceHost,
  useCredentialWorkspaceId,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/credential-workspace'
import {
  OrganizationSecretInputHost,
  useOrganizationSecretInput,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/organization-secret-input'
import {
  resolveOAuthChipTarget,
  useOAuthChipConnection,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/use-oauth-chip-connection'
import { usePersonalCredentialConnection } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/use-personal-credential-connection'
import { ResourceWorkspaceHost } from '@/app/workspace/[workspaceId]/home/components/resource-workspace-host'
import { usePlanUpgradeLink } from '@/app/workspace/[workspaceId]/home/hooks/use-plan-upgrade-link'
// Deep import, not the barrel: the barrel also re-exports
// ConnectServiceAccountModal, and that edge would pull the modal into this
// chunk and defeat the lazy() split below.
import { useServiceAccountConnectTarget } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/use-service-account-connect'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-context'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { BrandIcon } from '@/blocks/brand-icon'
import { MemberLimitRequestAction } from '@/ee/access-requests/components/member-limit-request-action'
import {
  useUpdateWorkspaceCredential,
  useWorkspaceCredential,
  useWorkspaceCredentials,
} from '@/hooks/queries/credentials'
import {
  usePersonalEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFileAtPath, useWorkspaceFileLookup } from '@/hooks/queries/workspace-files'
import { useWorkspaceUsageGate } from '@/hooks/queries/workspace-usage'

export {
  type ContentSegment,
  type CredentialItemData,
  type CredentialSubmissionPayload,
  type CredentialTagData,
  type CredentialTagType,
  formatCredentialSubmissionMessage,
  type IndexOfCache,
  type MothershipErrorTagData,
  memoizedIndexOf,
  type OptionsTagData,
  parseCredentialSubmissionMessage,
  parseCredentialSubmissionProgress,
  parseCredentialTagBody,
  parseLastCredentialTag,
  parseLastQuestionTag,
  parseQuestionTagBody,
  parseSpecialTags,
  type QuestionItem,
  type SecretInputScope,
  type SourceTagData,
  SPECIAL_TAG_NAMES,
  type UsageUpgradeTagData,
  type WorkspaceResourceTagData,
  type WorkspaceResourceTagType,
} from '@/lib/mothership/chat/special-tags'

/**
 * Kept out of the chat's initial chunk — it pulls in three provider-specific
 * setup forms and is only mounted once a message actually offers a service
 * account.
 */
const ConnectServiceAccountModal = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/connect-service-account-modal'
  ).then((m) => ({ default: m.ConnectServiceAccountModal }))
)

const ConnectPersonalTokenModal = lazy(() =>
  import('@/app/workspace/[workspaceId]/integrations/components/connect-personal-token-modal').then(
    (module) => ({ default: module.ConnectPersonalTokenModal })
  )
)

interface SpecialTagsProps {
  segment: Exclude<ContentSegment, { type: 'text' }>
  requestMode?: 'agent' | 'assistant' | 'plan'
  /** Stable identity for interaction state owned by this message/tag. */
  interactionId?: string
  /** Transcript-derived answers for this message's question card (renders the recap). */
  questionAnswers?: string[]
  /** Transcript-derived status payload for this message's credential card. */
  credentialSubmission?: CredentialSubmissionPayload
  /** The user moved on without submitting this message's credential card. */
  credentialAbandoned?: boolean
  onOptionSelect?: (id: string) => void
  onQuestionDismiss?: () => void
  onWorkspaceResourceSelect?: (resource: WorkspaceResourceRef) => void
}

/**
 * Unified renderer for inline special tags: `<options>`, `<usage_upgrade>`, `<credential>`,
 * and `<workspace_resource>`. A `<source>` never reaches here — the chat renderer
 * folds it into the surrounding markdown as an inline chip.
 */
export function SpecialTags({
  segment,
  requestMode,
  interactionId,
  questionAnswers,
  credentialSubmission,
  credentialAbandoned,
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
          requestMode={requestMode}
          interactionId={interactionId}
          submitted={credentialSubmission}
          abandoned={credentialAbandoned}
          onContinue={onOptionSelect}
        />
      )
    case 'mothership-error':
      return <MothershipErrorDisplay data={segment.data} />
    case 'workspace_resource':
      return <WorkspaceResourceDisplay data={segment.data} onSelect={onWorkspaceResourceSelect} />
    case 'source':
      return null
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
              'size-[14px] text-[var(--text-icon)] transition-transform duration-150',
              !expanded && '-rotate-90'
            )}
          />
        </button>
      ) : (
        <span className='block text-[var(--text-body)] text-sm'>Suggested follow-ups</span>
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
                  <div className='flex size-[16px] shrink-0 items-center justify-center'>
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
    case 'dashboard':
      return 'Dashboard'
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
    case 'dashboard':
      return { kind: 'dashboard', label, dashboardId: data.id ?? '' }
    case 'file':
      return { kind: 'file', label, fileId: data.id ?? data.path ?? '' }
  }
}

interface WorkspaceResourceDisplayProps {
  data: WorkspaceResourceTagData
  onSelect?: (resource: WorkspaceResourceRef) => void
}

export function WorkspaceResourceDisplay(props: WorkspaceResourceDisplayProps) {
  const { workspaceId, organizationId } = useParams<{
    workspaceId?: string
    organizationId?: string
  }>()
  if (organizationId) {
    const target = props.data.workspaceId
    if (!target) return <span role='status'>This resource needs an explicit workspace target.</span>
    return (
      <ResourceWorkspaceHost
        key={target}
        workspaceId={target}
        organizationId={organizationId}
        inline
      >
        <WorkspaceResourceDisplayContent {...props} workspaceId={target} addressed />
      </ResourceWorkspaceHost>
    )
  }
  if (!workspaceId || (props.data.workspaceId && props.data.workspaceId !== workspaceId))
    return <span role='status'>This resource belongs to a different workspace.</span>
  return <WorkspaceResourceDisplayContent {...props} workspaceId={workspaceId} />
}

function WorkspaceResourceDisplayContent({
  data,
  onSelect,
  workspaceId,
  addressed = false,
}: WorkspaceResourceDisplayProps & { workspaceId: string; addressed?: boolean }) {
  const { data: workflows = [] } = useWorkflows(workspaceId)
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: knowledgeBases = [] } = useKnowledgeBasesQuery(workspaceId)
  const isFile = data.type === 'file'
  const idLookup = useWorkspaceFileLookup(workspaceId, 'id', isFile ? data.id : undefined)
  const fileById = idLookup.data
  /** Only when the id names no file (or there is none): a path is the chip's fallback identity. */
  const { file: fileFromPath } = useWorkspaceFileAtPath(
    workspaceId,
    isFile ? data.path : undefined,
    {
      enabled: !data.id || fileById === null || idLookup.isError,
    }
  )

  const resource = useMemo<WorkspaceResourceRef>(() => {
    const title =
      data.type === 'workflow'
        ? (workflows.find((workflow) => workflow.id === data.id)?.name ??
          fallbackWorkspaceResourceTitle(data.type))
        : data.type === 'table'
          ? (tables.find((table) => table.id === data.id)?.name ??
            fallbackWorkspaceResourceTitle(data.type))
          : data.type === 'dashboard'
            ? (data.title ?? fallbackWorkspaceResourceTitle(data.type))
            : data.type === 'file'
              ? (fileById?.name ??
                fileFromPath?.name ??
                data.title ??
                fallbackWorkspaceResourceTitle(data.type))
              : (knowledgeBases.find((knowledgeBase) => knowledgeBase.id === data.id)?.name ??
                fallbackWorkspaceResourceTitle(data.type))

    const id = data.id ?? fileFromPath?.id
    return {
      type: toMothershipResourceType(data.type),
      ...(addressed ? { workspaceId } : {}),
      ...(id ? { id } : {}),
      title,
      ...(data.type === 'file' && data.path ? { path: data.path } : {}),
    }
  }, [
    data.id,
    data.path,
    data.title,
    data.type,
    fileById,
    fileFromPath,
    knowledgeBases,
    tables,
    workflows,
    addressed,
    workspaceId,
  ])

  const context = toChatMessageContext(data, resource.title)

  return (
    <ResourceMention
      icon={
        <ContextMentionIcon
          context={context}
          className='size-[12px] shrink-0 text-[var(--text-icon)]'
        />
      }
      title={resource.title}
      onSelect={onSelect ? () => onSelect(resource) : undefined}
    />
  )
}

function getCredentialIcon(provider: string): React.ComponentType<{ className?: string }> | null {
  const lower = provider.toLowerCase()
  if (lower === 'gitlab')
    return resolveCredentialDisplay({
      type: 'personal_token',
      providerId: lower,
      displayName: provider,
    }).icon

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
  if (provider.toLowerCase() === 'gitlab')
    return resolveCredentialDisplay({
      type: 'personal_token',
      providerId: 'gitlab',
      displayName: provider,
    }).detailTitle
  return (
    getServiceConfigByProviderId(provider)?.name ??
    OAUTH_PROVIDERS[provider.toLowerCase()]?.name ??
    provider
  )
}

/**
 * Inline "paste a secret" widget rendered for
 * `<credential>{"type":"secret_input","name":"OPENAI_API_KEY"}</credential>`.
 * Reuses the shared emcn SecretInput; the pasted value is saved straight to
 * workspace (default) or personal environment variables under `name` and never
 * flows back through the chat transcript.
 */
interface CredentialControlProps {
  data: CredentialItemData
  requestMode?: 'agent' | 'assistant' | 'plan'
  controlId?: string
  embedded?: boolean
  divided?: boolean
  secretValue?: string
  disabled?: boolean
  onSecretValueChange?: (value: string) => void
  onSaved?: () => void
  onConnected?: () => void
}

/**
 * Attaches the agent-authored descriptions to workspace secrets once their values
 * are saved, reusing the credential update endpoint the secrets settings page
 * calls. It runs after the value write because that write is what mints the
 * credential row a description hangs on, and it is best-effort: the value is the
 * point of the card, so a failed note never fails the save. Personal rows are
 * skipped — their credential rows are per-workspace mirrors of one user-global
 * secret, so no single row can own a description.
 */
function useWorkspaceSecretDescriptions(items: CredentialItemData[]) {
  const workspaceId = useCredentialWorkspaceId()
  const describedByName = useMemo(() => {
    const entries = new Map<string, string>()
    for (const item of items) {
      if (item.type !== 'secret_input' || (item.scope && item.scope !== 'workspace')) continue
      const name = item.name?.trim()
      const description = item.description?.trim()
      if (name && description) entries.set(name, description)
    }
    return entries
  }, [items])

  const credentialsQuery = useWorkspaceCredentials({
    workspaceId,
    type: 'env_workspace',
    enabled: describedByName.size > 0,
  })
  const updateCredential = useUpdateWorkspaceCredential()
  const refetchCredentials = credentialsQuery.refetch

  return useCallback(
    async (savedNames: string[]) => {
      const pending = savedNames.filter((name) => describedByName.has(name))
      if (pending.length === 0) return

      try {
        const { data } = await refetchCredentials()
        const idByEnvKey = new Map((data ?? []).map((row) => [row.envKey, row.id]))
        await Promise.all(
          pending.map(async (name) => {
            const credentialId = idByEnvKey.get(name)
            if (!credentialId) return
            await updateCredential.mutateAsync({
              credentialId,
              description: describedByName.get(name),
            })
          })
        )
      } catch {
        // Swallowed deliberately: the secret is stored, and the card must not
        // report failure over a missing note.
      }
    },
    [describedByName, refetchCredentials, updateCredential.mutateAsync]
  )
}

function SecretInputDisplay({ data, divided = false, onSaved }: CredentialControlProps) {
  const workspaceId = useCredentialWorkspaceId()
  const secretName = (data.name ?? '').trim()
  const scope = data.scope ?? 'workspace'
  const organizationSecretInput = useOrganizationSecretInput()

  const [value, setValue] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [saved, setSaved] = useState(false)

  const upsertWorkspace = useUpsertWorkspaceEnvironment()
  const savePersonal = useSavePersonalEnvironment()
  const personalQuery = usePersonalEnvironment({ enabled: scope === 'personal' })
  const personalEnv = personalQuery.data
  const { canEdit } = useUserPermissionsContext()
  const attachDescriptions = useWorkspaceSecretDescriptions(useMemo(() => [data], [data]))

  // Setting a workspace var needs write/admin (same gate as the secrets manager);
  // personal vars are the user's own, so any member may set them.
  const canManage =
    scope === 'organization' ? Boolean(organizationSecretInput) : scope === 'personal' || canEdit

  const isSaving =
    upsertWorkspace.isPending || savePersonal.isPending || organizationSecretInput?.isSaving
  // Personal saves replace the whole map, so block until existing vars are loaded.
  const personalReady = scope !== 'personal' || personalEnv !== undefined
  const canSave =
    canManage && secretName.length > 0 && value.trim().length > 0 && !isSaving && personalReady

  const handleSave = async () => {
    if (!canSave) return
    try {
      if (scope === 'organization') {
        if (!organizationSecretInput) return
        await organizationSecretInput.save({ [secretName]: value })
      } else if (scope === 'personal') {
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
        await attachDescriptions([secretName])
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
      disabled={isSaving}
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
          <Tooltip.Content>{isSaving ? 'Saving' : 'Save'}</Tooltip.Content>
        </Tooltip.Root>
      }
    />
  )
}

interface CredentialSecretInputRowProps {
  name: string
  value: string
  divided?: boolean
  disabled?: boolean
  onChange: (value: string) => void
}

/** Secret draft field for the unified card; the card's final Submit owns persistence. */
function CredentialSecretInputRow({
  name,
  value,
  divided = false,
  disabled = false,
  onChange,
}: CredentialSecretInputRowProps) {
  const [isFocused, setIsFocused] = useState(false)

  return (
    <InteractionCardInputRow
      divided={divided}
      disabled={disabled}
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
        {picking ? 'Choose a folder' : label}
      </span>
      {grantedName === null && (
        <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
      )}
    </button>
  )
}

/**
 * Shared browser hand-back question. While active it reports the selected
 * answer; after completion the same component renders its answered recap.
 */
export function BrowserTakeoverQuestion({
  reason,
  answer,
  onAnswer,
}: {
  reason?: string
  answer?: string
  onAnswer?: (answer: string) => void
}) {
  const normalizedReason = reason?.trim() ?? ''
  const normalizedAnswer = answer?.trim() ?? ''
  const prompt = normalizedReason || 'Finish in the browser'
  const questions: QuestionItem[] = [
    {
      type: 'single_select',
      prompt,
      options: [{ id: 'continue', label: 'Continue' }],
    },
  ]

  return (
    <QuestionDisplay
      data={questions}
      answers={normalizedAnswer ? [normalizedAnswer] : undefined}
      dismissible={false}
      onSelect={
        onAnswer
          ? (message) => {
              const answer = parseQuestionAnswerMessage(questions, message)?.[0]?.trim()
              if (answer) onAnswer(answer)
            }
          : undefined
      }
    />
  )
}

/** Connects the active browser question to the desktop panel action. */
function BrowserTakeoverDisplay({ data }: { data: CredentialItemData }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { chatId } = useChatSurface()

  if (!isBrowserAgentAvailable()) return null

  return (
    <BrowserTakeoverQuestion
      reason={data.name}
      onAnswer={(answer) => {
        const takeoverResponse = answer !== 'Continue' ? answer : undefined
        sendBrowserPanelAction(
          'takeover-done',
          takeoverResponse ? { takeoverResponse } : {},
          desktopChatScopeId(workspaceId, chatId)
        )
      }}
    />
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
  const workspaceId = useCredentialWorkspaceId()
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
        <BrandIcon icon={target.serviceIcon} className='size-[16px] shrink-0' />
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
            atlassianProduct={match?.providerId === 'confluence' ? 'confluence' : 'jira'}
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
  const Icon = getCredentialIcon(data.provider) ?? Lock
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
      ? `Checking ${integrationName} connections`
      : status === 'pending'
        ? `Waiting for ${integrationName} connection`
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
      <BrandIcon icon={Icon} className='size-[16px] shrink-0' />
      <span className='flex-1 text-[var(--text-body)] text-sm'>{displayLabel}</span>
      {connected ? (
        <Check className='size-[16px] shrink-0 text-[var(--text-icon)]' />
      ) : (
        <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
      )}
    </a>
  )
}

function PersonalCredentialLinkDisplay({
  data,
  controlId = 'credential-link',
  embedded = false,
  divided = false,
  onConnected,
}: CredentialControlProps) {
  const workspaceId = useCredentialWorkspaceId()
  const { canEdit } = useUserPermissionsContext()
  const [tokenModalOpen, setTokenModalOpen] = useState(false)
  const provider = data.provider?.trim() ?? ''
  const name = getCredentialProviderDisplayName(provider)
  const connection = usePersonalCredentialConnection({
    provider,
    displayName: name,
    controlId,
    onConnected,
  })
  if (!provider || (provider.toLowerCase() === 'gitlab' && !canEdit)) return null
  const Icon = getCredentialIcon(provider) ?? Lock
  const connected = connection.status === 'connected'
  const label = connected
    ? `Connected ${name}`
    : connection.hasMetadataError
      ? `Retry checking ${name} connections`
      : !connection.isReady
        ? `Checking ${name} connections`
        : connection.status === 'pending'
          ? `Waiting for ${name} connection`
          : connection.status === 'failed'
            ? `Not connected — connect ${name}`
            : `Connect ${name}`
  return (
    <>
      <button
        type='button'
        disabled={
          (!connection.isReady && !connection.hasMetadataError) ||
          connected ||
          connection.isStarting
        }
        onClick={() => {
          if (connection.hasMetadataError) {
            void connection.retryMetadata()
            return
          }
          if (provider.toLowerCase() === 'gitlab') {
            connection.beginPersonalToken()
            setTokenModalOpen(true)
          } else connection.connectOAuth()
        }}
        className={cn(
          embedded
            ? INTERACTION_CARD_ROW_CLASSES
            : 'flex w-full items-center gap-2 rounded-2xl border border-[var(--border)] px-3 py-2.5 text-left transition-colors',
          embedded && divided && 'border-t',
          'hover-hover:bg-[var(--surface-5)]'
        )}
      >
        <BrandIcon icon={Icon} className='size-[16px] shrink-0' />
        <span className='flex-1 text-[var(--text-body)] text-sm'>{label}</span>
        {connected ? (
          <Check className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        ) : (
          <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        )}
      </button>
      {connection.error && (
        <p role='alert' className='px-3 py-2 text-[var(--text-error)] text-caption'>
          {connection.error}
        </p>
      )}
      {tokenModalOpen && (
        <Suspense fallback={null}>
          <ConnectPersonalTokenModal
            open={tokenModalOpen}
            onOpenChange={(open) => {
              setTokenModalOpen(open)
              if (!open) connection.cancelPersonalToken()
            }}
            workspaceId={workspaceId}
            onConnected={connection.connectedPersonalToken}
          />
        </Suspense>
      )}
    </>
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

/**
 * sim_key stays in the routing set so a payload carrying one still takes the
 * card path (CredentialDisplay renders its reveal separately), but it is an
 * output, so the card itself never shows it as a row.
 */
const CREDENTIAL_CARD_TYPES: ReadonlySet<CredentialTagType> = new Set([
  'secret_input',
  'link',
  'service_account',
  'sim_key',
])

function isCredentialCardItemVisible(
  item: CredentialItemData,
  canEdit: boolean,
  requestMode?: 'agent' | 'assistant' | 'plan'
): boolean {
  if (requestMode === 'assistant')
    return (
      item.type === 'link' &&
      Boolean(item.provider?.trim()) &&
      (item.provider?.trim().toLowerCase() !== 'gitlab' || canEdit)
    )
  if (item.type === 'sim_key') return false
  if (item.type === 'secret_input')
    return item.scope === 'personal' || item.scope === 'organization' || canEdit
  if (item.type === 'link') {
    return canEdit && Boolean(item.provider) && Boolean(item.value && isSafeHttpUrl(item.value))
  }
  return canEdit
}

/** Whether a terminal credential tag produces the shared question-style card. */
export function credentialTagHasVisibleCard(
  data: CredentialTagData,
  canEdit: boolean,
  requestMode?: 'agent' | 'assistant' | 'plan'
): boolean {
  return (
    data.length > 0 &&
    data.every((item) => CREDENTIAL_CARD_TYPES.has(item.type)) &&
    data.some((item) => isCredentialCardItemVisible(item, canEdit, requestMode))
  )
}

function CredentialItemDisplay({
  data,
  requestMode,
  controlId = 'credential-link',
  embedded = false,
  divided = false,
  secretValue,
  disabled,
  onSecretValueChange,
  onSaved,
  onConnected,
}: CredentialControlProps) {
  const { organizationId } = useParams<{ organizationId?: string }>()
  const { SearchConnectionComponent } = useChatSurface()
  const { data: session } = useSession()
  const organizationSecretInput = useOrganizationSecretInput()
  if (
    requestMode === 'assistant' &&
    data.type !== 'link' &&
    data.type !== 'browser_takeover' &&
    data.type !== 'terminal_handoff'
  )
    return null
  if (data.type === 'secret_input') {
    const secretName = data.name?.trim()
    if (embedded) {
      if (!secretName || !onSecretValueChange) return null
      return (
        <CredentialSecretInputRow
          name={secretName}
          value={secretValue ?? ''}
          divided={divided}
          disabled={disabled}
          onChange={onSecretValueChange}
        />
      )
    }
    return (
      <SecretInputDisplay
        key={data.scope === 'organization' ? organizationSecretInput?.sourceKey : undefined}
        data={data}
        embedded={embedded}
        divided={divided}
        onSaved={onSaved}
      />
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
    if (requestMode === 'assistant') {
      if (organizationId) {
        const target = searchConnectionTargetSchema.safeParse(data)
        if (!target.success || !session?.user?.id) return null
        if (!SearchConnectionComponent)
          throw new Error('Search connection controls require an organization chat surface')
        return (
          <SearchConnectionComponent
            organizationId={organizationId}
            userId={session.user.id}
            target={target.data}
            controlId={controlId}
            embedded={embedded}
            divided={divided}
            onConnected={onConnected}
          />
        )
      }
      return (
        <PersonalCredentialLinkDisplay
          data={data}
          controlId={controlId}
          embedded={embedded}
          divided={divided}
          onConnected={onConnected}
        />
      )
    }
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

  // sim_key never reaches here: CredentialDisplay renders its reveal chip
  // standalone (SecretReveal masks itself when the tag carries no value).
  return null
}

/**
 * Credential input and OAuth controls use the same InteractionCard primitives
 * as QuestionDisplay. Integrations come first and secrets follow in one card
 * with one Submit; legacy/system actions retain their standalone presentation.
 */
function CredentialInputCard({
  data,
  requestMode,
  interactionId,
  submitted,
  abandoned,
  onContinue,
}: {
  data: CredentialTagData
  requestMode?: 'agent' | 'assistant' | 'plan'
  interactionId?: string
  submitted?: CredentialSubmissionPayload
  abandoned?: boolean
  onContinue?: (message: string) => void
}) {
  const workspaceId = useCredentialWorkspaceId()
  const { organizationId } = useParams<{ organizationId?: string }>()
  const { data: session } = useSession()
  const { canEdit } = useUserPermissionsContext()
  const upsertWorkspace = useUpsertWorkspaceEnvironment()
  const savePersonal = useSavePersonalEnvironment()
  const organizationSecretInput = useOrganizationSecretInput()
  const personalQuery = usePersonalEnvironment({
    enabled:
      requestMode !== 'assistant' &&
      data.some((item) => item.type === 'secret_input' && item.scope === 'personal'),
  })
  const attachDescriptions = useWorkspaceSecretDescriptions(requestMode === 'assistant' ? [] : data)
  const organizationSourceKey = organizationSecretInput?.sourceKey
  const currentOrganizationSource = useRef(organizationSourceKey)
  const [secretState, setSecretState] = useState(() => ({
    organizationSourceKey,
    drafts: {} as Record<number, string>,
    savedRows: new Set<number>(),
  }))
  const { drafts: secretDrafts, savedRows: savedSecretRows } = secretState
  const [connectedIntegrationRows, setConnectedIntegrationRows] = useState<Set<number>>(
    () => new Set()
  )
  const [locallySubmitted, setLocallySubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const controlIdPrefix = interactionId ?? 'credential-card'

  /** Async submissions compare against the committed source, including unmount. */
  useLayoutEffect(() => {
    currentOrganizationSource.current = organizationSourceKey
    return () => {
      currentOrganizationSource.current = undefined
    }
  }, [organizationSourceKey])

  /**
   * An abandoned card recaps from progress its rows made, but it replaces those
   * rows — so on a fresh mount nothing is left to report a connect the user
   * already finished, and the recap would read "Skipped" over it. An OAuth
   * connect records a row-scoped attempt that outlives the mount, so restore
   * the verdict from there.
   *
   * Only OAuth rows need this. A secret is written solely by Submit, which ends
   * the card as a real submission instead; a service-account connect never
   * outlives its own row either way.
   */
  useEffect(() => {
    if (!abandoned) return
    const restored = new Set<number>()
    let restoreIndex = 0
    for (const [dataIndex, item] of data.entries()) {
      if (item.type !== 'link' && item.type !== 'service_account') continue
      const index = restoreIndex++
      if (item.type !== 'link') continue
      if (requestMode === 'assistant' && organizationId && session?.user?.id) {
        const target = searchConnectionTargetSchema.safeParse(item)
        if (!target.success) continue
        const attempt = readSearchConnectionAttempt(
          searchConnectionAttemptKey(
            organizationId,
            session.user.id,
            `${controlIdPrefix}:${dataIndex}:${JSON.stringify(target.data)}`
          )
        )
        if (attempt?.status === 'connected') restored.add(index)
        continue
      }
      const { providerId, reconnectCredentialId } =
        requestMode === 'assistant'
          ? {
              providerId:
                resolveOAuthServiceForSlug(item.provider ?? '')?.providerId ?? item.provider ?? '',
              reconnectCredentialId: undefined,
            }
          : resolveOAuthChipTarget(item.value, item.provider)
      if (!providerId) continue
      const attempt = readLatestOAuthChatAttempt({
        workspaceId,
        providerId,
        controlId: `${requestMode === 'assistant' ? 'personal:' : ''}${controlIdPrefix}:${dataIndex}`,
        credentialId: reconnectCredentialId,
      })
      if (attempt?.status === 'connected') restored.add(index)
    }
    if (restored.size === 0) return
    setConnectedIntegrationRows((current) => {
      if (Array.from(restored).every((index) => current.has(index))) return current
      return new Set([...current, ...restored])
    })
  }, [
    abandoned,
    controlIdPrefix,
    data,
    workspaceId,
    requestMode,
    organizationId,
    session?.user?.id,
  ])

  let integrationIndex = 0
  let secretIndex = 0
  const indexedRows = data.map((item, dataIndex) => ({
    item,
    dataIndex,
    integrationIndex:
      item.type === 'link' || item.type === 'service_account' ? integrationIndex++ : undefined,
    secretIndex: item.type === 'secret_input' ? secretIndex++ : undefined,
  }))
  const organizationSecretIndexes = indexedRows.flatMap(({ item, secretIndex }) =>
    item.type === 'secret_input' && item.scope === 'organization' && secretIndex !== undefined
      ? [secretIndex]
      : []
  )
  if (secretState.organizationSourceKey !== organizationSourceKey) {
    setSecretState({
      organizationSourceKey,
      drafts: omit(secretDrafts, organizationSecretIndexes),
      savedRows:
        submitted || abandoned || locallySubmitted
          ? savedSecretRows
          : new Set(
              [...savedSecretRows].filter((index) => !organizationSecretIndexes.includes(index))
            ),
    })
  }
  const visibleRows = indexedRows.filter(
    ({ item }) =>
      isCredentialCardItemVisible(item, canEdit, requestMode) &&
      (item.type !== 'secret_input' ||
        item.scope !== 'organization' ||
        organizationSecretInput ||
        submitted ||
        abandoned ||
        locallySubmitted)
  )
  if (visibleRows.length === 0) return null

  const integrationRows = visibleRows.filter(
    ({ item }) => item.type === 'link' || item.type === 'service_account'
  )
  const secretRows = visibleRows.filter(({ item }) => item.type === 'secret_input')
  const title =
    integrationRows.length > 0 && secretRows.length > 0
      ? 'Set up credentials'
      : integrationRows.length > 0
        ? 'Connect integrations'
        : 'Add secrets'
  const rows = [
    ...integrationRows.map(({ item, dataIndex, integrationIndex }, index) => (
      <CredentialItemDisplay
        key={`${item.type}-${item.provider ?? dataIndex}-${dataIndex}`}
        data={item}
        requestMode={requestMode}
        controlId={`${controlIdPrefix}:${dataIndex}`}
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
      if (secretIndex !== undefined && savedSecretRows.has(secretIndex))
        return (
          <div
            key={`saved-${dataIndex}`}
            className={cn(
              INTERACTION_CARD_ROW_CLASSES,
              (integrationRows.length > 0 || index > 0) && 'border-t'
            )}
          >
            <span className='flex-1 text-sm'>{item.name}</span>
            <span className='text-[var(--text-muted)] text-sm'>Added</span>
          </div>
        )
      return (
        <CredentialItemDisplay
          key={`${item.type}-${item.name ?? dataIndex}-${dataIndex}`}
          data={item}
          embedded
          disabled={isSubmitting}
          divided={integrationRows.length > 0 || index > 0}
          secretValue={
            item.type === 'secret_input' ? (secretDrafts[secretIndex ?? -1] ?? '') : undefined
          }
          onSecretValueChange={
            item.type === 'secret_input' && secretIndex !== undefined
              ? (value) =>
                  setSecretState((current) => ({
                    ...current,
                    drafts: { ...current.drafts, [secretIndex]: value },
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
    const organizationVariables: Record<string, string> = {}

    for (const { item, secretIndex } of secretRows) {
      if (secretIndex === undefined) continue
      const name = item.name?.trim()
      const value = secretDrafts[secretIndex] ?? ''
      if (!name || value.trim().length === 0) continue
      const target =
        item.scope === 'organization'
          ? organizationVariables
          : item.scope === 'personal'
            ? personalVariables
            : workspaceVariables
      target[name] = value
    }

    const nextSavedSecretRows = new Set(savedSecretRows)
    const saveGroup = async (
      scope: SecretInputScope,
      variables: Record<string, string>,
      save: () => Promise<unknown>
    ) => {
      await save()
      for (const { item, secretIndex } of secretRows) {
        if (
          secretIndex !== undefined &&
          (item.scope ?? 'workspace') === scope &&
          Object.hasOwn(variables, item.name?.trim() ?? '')
        )
          nextSavedSecretRows.add(secretIndex)
      }
      if (scope === 'workspace') await attachDescriptions(Object.keys(variables))
    }

    const saves: Promise<unknown>[] = []
    if (Object.keys(organizationVariables).length > 0) {
      if (!organizationSecretInput) return false
      saves.push(
        saveGroup('organization', organizationVariables, () =>
          organizationSecretInput.save(organizationVariables)
        )
      )
    }
    if (Object.keys(workspaceVariables).length > 0) {
      saves.push(
        saveGroup('workspace', workspaceVariables, () =>
          upsertWorkspace.mutateAsync({ workspaceId, variables: workspaceVariables })
        )
      )
    }
    if (Object.keys(personalVariables).length > 0) {
      saves.push(
        saveGroup('personal', personalVariables, async () => {
          const { data: latest } = await personalQuery.refetch()
          const merged: Record<string, string> = {}
          for (const [key, entry] of Object.entries(latest ?? personalQuery.data ?? {})) {
            merged[key] = entry.value
          }
          Object.assign(merged, personalVariables)
          await savePersonal.mutateAsync({ variables: merged })
        })
      )
    }
    const results = await Promise.allSettled(saves)
    setSecretState((current) => {
      const completedRows = [...nextSavedSecretRows].filter(
        (index) =>
          current.organizationSourceKey === organizationSourceKey ||
          !organizationSecretIndexes.includes(index)
      )
      return {
        ...current,
        savedRows: new Set([...current.savedRows, ...completedRows]),
        drafts: omit(current.drafts, completedRows),
      }
    })
    if (results.some((result) => result.status === 'rejected')) {
      toast.error(`Couldn't save all secrets. Retry the remaining entries.`)
      return false
    }
    if (
      currentOrganizationSource.current !== organizationSourceKey &&
      organizationSecretIndexes.some((index) => nextSavedSecretRows.has(index))
    ) {
      toast.error('Generic Secrets changed. Review the remaining entries before submitting.')
      return false
    }

    onContinue(
      formatCredentialSubmissionMessage(data, {
        connectedIntegrationIndexes: connectedIntegrationRows,
        savedSecretIndexes: nextSavedSecretRows,
      })
    )
    return true
  }

  const needsContinuation = integrationRows.length > 0 || secretRows.length > 0
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
      const saved = submitted
        ? submitted.secrets[secretIndex ?? -1]?.status === 'saved'
        : savedSecretRows.has(secretIndex ?? -1)
      return {
        label: item.name ?? 'Secret',
        status: saved ? ('Added' as const) : ('Skipped' as const),
      }
    }),
  ]

  // An abandoned card recaps from local progress only: a row the user connected
  // or saved before moving on keeps its status, everything else reads "Skipped".
  if (submitted || locallySubmitted || (abandoned && needsContinuation)) {
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

/** Workspace credential controls in organization chat require one explicit, authorized target. */
export function CredentialDisplay(props: Parameters<typeof CredentialDisplayContent>[0]) {
  const { organizationId, workspaceId } = useParams<{
    organizationId?: string
    workspaceId?: string
  }>()
  if (props.requestMode === 'assistant') return <CredentialDisplayContent {...props} />
  const organizationSecrets = props.data.filter(
    (item) => item.type === 'secret_input' && item.scope === 'organization'
  )
  if (
    organizationSecrets.length > 0 &&
    (!organizationId || organizationSecrets.some((item) => item.workspaceId))
  )
    return (
      <p role='status'>
        Organization Generic Secrets require an organization conversation and no workspace target.
      </p>
    )
  const targeted = props.data.filter(
    (item) =>
      item.type === 'link' ||
      item.type === 'service_account' ||
      // A masked key has nothing to copy, so only a revealed one needs its workspace.
      (item.type === 'sim_key' && item.value !== undefined) ||
      (item.type === 'secret_input' && (!item.scope || item.scope === 'workspace'))
  )
  const targets = new Set(targeted.map((item) => item.workspaceId).filter(Boolean))
  const target = targets.values().next().value
  const mismatchedLink =
    Boolean(organizationId) &&
    targeted.some((item) => {
      if (item.type !== 'link' || !item.value) return false
      try {
        return new URL(item.value).searchParams.get('workspaceId') !== item.workspaceId
      } catch {
        return true
      }
    })
  const invalid =
    mismatchedLink ||
    targets.size > 1 ||
    (organizationId && targeted.some((item) => !item.workspaceId)) ||
    (!organizationId && target && target !== workspaceId)
  if (invalid)
    return <p role='status'>This credential request needs one explicit workspace target.</p>
  const content =
    organizationSecrets.length > 0 && !props.submitted && !props.abandoned ? (
      <OrganizationSecretInputHost organizationId={organizationId ?? ''}>
        <CredentialDisplayContent {...props} />
      </OrganizationSecretInputHost>
    ) : (
      <CredentialDisplayContent {...props} />
    )
  if (organizationId && target) {
    return (
      <CredentialWorkspaceHost key={target} workspaceId={target} organizationId={organizationId}>
        {content}
      </CredentialWorkspaceHost>
    )
  }
  return content
}

function CredentialDisplayContent({
  data,
  requestMode,
  interactionId,
  submitted,
  abandoned,
  onContinue,
}: {
  data: CredentialTagData
  requestMode?: 'agent' | 'assistant' | 'plan'
  interactionId?: string
  submitted?: CredentialSubmissionPayload
  abandoned?: boolean
  onContinue?: (message: string) => void
}) {
  // A sim_key is an OUTPUT — the workspace API key the platform filled in —
  // never a setup request, so it renders as its own reveal chip outside any
  // card. Inside the question-style card it read as something to submit, and
  // the card's recap swallowed the key after Submit. The reveal also outlives
  // submission/abandonment: the key must stay retrievable. The full payload
  // still flows to the card so row indexes (OAuth controlIds, submission
  // pairing) stay stable — the card simply renders no sim_key rows.
  const simKeyReveals = data
    .map((item, index) =>
      item.type === 'sim_key' && requestMode !== 'assistant' ? (
        <SecretReveal key={`sim-key-${index}`} value={item.value} />
      ) : null
    )
    .filter(Boolean)
  const inputItems = data.filter((item) => item.type !== 'sim_key')
  const usesCredentialCard = data.every((item) => CREDENTIAL_CARD_TYPES.has(item.type))

  const inputControls = usesCredentialCard ? (
    <CredentialInputCard
      data={data}
      requestMode={requestMode}
      interactionId={interactionId}
      submitted={submitted}
      abandoned={abandoned}
      onContinue={onContinue}
    />
  ) : inputItems.length > 0 ? (
    <div className={cn(inputItems.length > 1 && 'space-y-3')}>
      {inputItems.map((item, index) => (
        <CredentialItemDisplay
          key={`${item.type}-${item.provider ?? item.name ?? index}`}
          data={item}
          requestMode={requestMode}
        />
      ))}
    </div>
  ) : null

  if (simKeyReveals.length === 0) return inputControls
  return (
    <div className='space-y-3'>
      {simKeyReveals}
      {inputControls}
    </div>
  )
}

/**
 * The message is the whole user-facing story. The raw `code` is an internal
 * identifier ("async_resume_aborted") that means nothing to a reader and made
 * every error line end in parenthesized jargon; it stays in the tag payload for
 * logs and support, just not on screen.
 */
function MothershipErrorDisplay({ data }: { data: MothershipErrorTagData }) {
  return (
    <p className='text-[var(--text-secondary)] text-small italic leading-[20px]'>{data.message}</p>
  )
}

function UsageUpgradeDisplay({ data }: { data: UsageUpgradeTagData }) {
  return data.reason === 'job_run_budget' ? (
    <JobRunBudgetDisplay message={data.message} />
  ) : (
    <PlanUsageLimitDisplay data={data} />
  )
}

/**
 * A scheduled job's run reached its own spend cap. The cap belongs to the job, not to the
 * account, so the card offers no billing action: the next run starts with a fresh cap.
 */
interface JobRunBudgetDisplayProps {
  message: string
}

function JobRunBudgetDisplay({ message }: JobRunBudgetDisplayProps) {
  return (
    <InteractionCard
      title={
        <span className='inline-flex items-center gap-2'>
          <TriangleAlert
            aria-hidden
            className='size-[14px] shrink-0 text-[var(--badge-amber-text)]'
          />
          Run Spend Limit Reached
        </span>
      }
    >
      <div className='px-2 pb-2'>
        <p className='text-[var(--text-body)] text-small leading-5'>{message}</p>
      </div>
    </InteractionCard>
  )
}

interface PlanUsageLimitDisplayProps {
  data: UsageUpgradeTagData
}

/**
 * The payer's plan limit, or a free plan that does not include Chat: the card links to where
 * the plan or the limit can change, and a workspace's plan to its upgrade page.
 */
function PlanUsageLimitDisplay({ data }: PlanUsageLimitDisplayProps) {
  const hostContext = useOptionalWorkspaceHostContext()
  const { href, opensInNewTab, buttonLabel, canManageBilling, unavailableMessage } =
    usePlanUpgradeLink(data)
  const planRequired = data.reason === CHAT_PLAN_REQUIRED_REASON
  const usageGate = useWorkspaceUsageGate(
    data.action === 'increase_limit' && !canManageBilling ? hostContext?.workspace.id : undefined
  )

  return (
    <InteractionCard
      title={
        <span className='inline-flex items-center gap-2'>
          <TriangleAlert
            aria-hidden
            className='size-[14px] shrink-0 text-[var(--badge-amber-text)]'
          />
          {planRequired ? 'Paid Plan Required' : 'Usage Limit Reached'}
        </span>
      }
    >
      <div className='px-2 pb-2'>
        <p className='text-[var(--text-body)] text-small leading-5'>{data.message}</p>
        {canManageBilling ? (
          <ChipLink
            href={href}
            onNavigate={() => rememberSettingsReturnUrl(href)}
            variant='border'
            rightIcon={opensInNewTab ? SquareArrowUpRight : ArrowRight}
            target={opensInNewTab ? '_blank' : undefined}
            rel={opensInNewTab ? 'noopener noreferrer' : undefined}
            aria-label={opensInNewTab ? `${buttonLabel} (opens in a new tab)` : undefined}
            className='mt-2'
          >
            {buttonLabel}
          </ChipLink>
        ) : (
          <div className='mt-2 flex flex-col items-start gap-2'>
            <p className='text-[var(--text-secondary)] text-small'>{unavailableMessage}</p>
            {hostContext &&
              usageGate.isSuccess &&
              usageGate.data.isExceeded &&
              usageGate.data.scope === 'member' && (
                <MemberLimitRequestAction
                  scope={{ kind: 'workspace', workspaceId: hostContext.workspace.id }}
                />
              )}
          </div>
        )}
      </div>
    </InteractionCard>
  )
}
