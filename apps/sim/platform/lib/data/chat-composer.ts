'use client'

import { useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { useQueries } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/client'
import { useFeatureFlag } from '@/lib/core/config/feature-flags-context'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import {
  getMothershipAttachmentPreviewUrl,
  getMothershipAttachmentUrl,
} from '@/lib/mothership/chat/attachment-preview'
import {
  MOTHERSHIP_EFFORT_OPTIONS,
  MOTHERSHIP_MODEL_OPTIONS,
  MOTHERSHIP_SIMPLE_EFFORT_OPTIONS,
  type MothershipEffort,
  resolveMothershipModelSettings,
} from '@/lib/mothership/model-options'
import { assertMultiFileUploadAdmission } from '@/lib/uploads/client/admission'
import {
  ASSISTANT_IMAGE_MAX_BYTES,
  ASSISTANT_IMAGE_MAX_COUNT,
  ASSISTANT_IMAGE_MAX_TOTAL_BYTES,
  isAssistantImageType,
} from '@/lib/uploads/shared/assistant-images'
import type { FileAttachmentForApi } from '@/app/workspace/[workspaceId]/home/types'
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import {
  useMothershipChatHistory,
  useSetMothershipChatEffort,
} from '@/hooks/queries/mothership-chats'
import { getSkillsQueryOptions } from '@/hooks/queries/skills'
import { getWorkflowListQueryOptions } from '@/hooks/queries/utils/workflow-list-query'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useVoiceInput } from '@/hooks/use-voice-input'
import type {
  ChatAttachment,
  ComposerController,
  ComposerDraft,
  ComposerReferences,
  ComposerSettings,
} from '@/platform/app/(shell)/_components/composer/model'
import type {
  ComposerHost,
  ComposerOptions,
} from '@/platform/app/(shell)/_components/session/composer-host'
import { draftToSend } from '@/platform/lib/data/chat-draft'
import { attachmentKind } from '@/platform/lib/data/chat-model'
import { useOrganization } from '@/platform/lib/data/organization'
import { useStartSearch } from '@/platform/lib/data/search'
import { toast } from '@/platform/lib/data/toast'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import {
  useMothershipEffortStore,
  useMothershipPlanEffortStore,
} from '@/stores/mothership-effort/store'
import type { ChatContext } from '@/stores/panel'

const ASSISTANT_ACCEPT = 'image/*'

function contextId(context: ChatContext, index: number): string {
  return `context:${index}:${context.kind}:${context.label}`
}

function selectedReferenceId(
  context: ChatContext,
  unscopedSkills: ReadonlyMap<string, string | null>
): string | undefined {
  if (context.kind === 'workspace') return context.workspaceId
  if (context.kind === 'workflow' && context.workspaceId)
    return `${context.workspaceId}:${context.workflowId}`
  if (context.kind === 'skill') {
    return context.workspaceId
      ? `${context.workspaceId}:${context.skillId}`
      : (unscopedSkills.get(context.skillId) ?? undefined)
  }
}

/** Model, effort and Fast, behind the same flags as the legacy selector, and Plan before a chat. */
function useComposerSettings(
  requestMode: ComposerOptions['requestMode'],
  chatId: string | undefined,
  onPlanChange: ((active: boolean) => void) | undefined
): ComposerSettings | undefined {
  const plan = requestMode === 'plan'
  const preferences = plan ? useMothershipPlanEffortStore : useMothershipEffortStore
  const advanced = useFeatureFlag('mothership-model-selector')
  const planEnabled = useFeatureFlag('mothership-plan-mode')
  const selection = preferences((state) => state.modelSelection)
  const setModel = preferences((state) => state.setModel)
  const setFastMode = preferences((state) => state.setFastMode)
  const { data: history } = useMothershipChatHistory(chatId)
  const chatPick = useMothershipEffortStore((state) =>
    chatId ? state.chatEfforts[chatId]?.effort : undefined
  )
  const newChatEffort = useMothershipEffortStore((state) => state.newChatEffort)
  const setNewChatEffort = useMothershipEffortStore((state) => state.setNewChatEffort)
  const { mutate: saveChatEffort } = useSetMothershipChatEffort(chatId)
  if (requestMode === 'assistant') return undefined
  const choice = chatId ? (chatPick ?? history?.effort) : newChatEffort
  const { effort, modelSelection } = resolveMothershipModelSettings(
    { effort: choice ?? undefined, modelSelection: selection },
    advanced,
    plan
  )
  const options = modelSelection ? MOTHERSHIP_EFFORT_OPTIONS : MOTHERSHIP_SIMPLE_EFFORT_OPTIONS
  return {
    effort: {
      value: effort,
      options: options.map((option) => ({ id: option.value, label: option.label })),
      onChange: (value) => {
        const next = value as MothershipEffort
        if (chatId) saveChatEffort(next)
        else setNewChatEffort(next)
      },
    },
    ...(advanced && modelSelection
      ? {
          model: {
            value: modelSelection.model,
            options: MOTHERSHIP_MODEL_OPTIONS.map((option) => ({
              id: option.value,
              label: option.label,
            })),
            onChange: (value: string) =>
              setModel(value as (typeof MOTHERSHIP_MODEL_OPTIONS)[number]['value']),
          },
          ...(modelSelection.model !== 'claude-opus-5-5'
            ? { fastMode: { enabled: modelSelection.fastMode, onChange: setFastMode } }
            : {}),
        }
      : {}),
    ...(planEnabled && onPlanChange && !chatId
      ? { plan: { active: plan, onChange: onPlanChange } }
      : {}),
  }
}

export type LiveComposer = ComposerController & {
  /** Puts a queued message back in the field for editing. */
  restore: (draft: { text: string; files: FileAttachmentForApi[]; contexts: ChatContext[] }) => void
}

/**
 * A draft persisted per viewer and chat through the legacy drafts store, with uploads through the
 * legacy attachment hook, so a reload, a queued edit and the upload rules all behave the same.
 */
export function useLiveComposer({
  draftKey,
  requestMode = 'agent',
  chatId,
  onPlanChange,
}: ComposerOptions & { onPlanChange?: (active: boolean) => void }): LiveComposer {
  const { organization } = useOrganization()
  const { data: session } = useSession()
  const userId = session?.user?.id
  const assistant = requestMode === 'assistant'
  const key = `${userId}:organization:${organization.id}:${draftKey}`
  const [initialKey] = useState(key)
  const saved = useMothershipDraftsStore((state) => state.drafts[key] ?? state.drafts[initialKey])
  const [initial] = useState(() => useMothershipDraftsStore.getState().drafts[key])
  useEffect(() => {
    if (initialKey !== key) useMothershipDraftsStore.getState().migrateDraft(initialKey, key)
  }, [initialKey, key])
  const [pickerOpened, setPickerOpened] = useState(false)
  const inventoryEnabled = !assistant && pickerOpened
  const { references, skills, referencesLoading, skillsLoading } = useOrganizationInventory(
    inventoryEnabled,
    organization.id
  )
  const files = useFileAttachments({
    userId,
    organizationId: organization.id,
    requestMode,
    initialAttachments: initial?.fileAttachments,
  })
  const contexts: ChatContext[] = saved?.contexts ?? []
  const text = saved?.text ?? ''

  useEffect(() => {
    const store = useMothershipDraftsStore.getState()
    const fileAttachments: FileAttachmentForApi[] = files.attachedFiles.flatMap((file) =>
      !file.uploading && file.key
        ? [
            {
              id: file.id,
              key: file.key,
              filename: file.name,
              media_type: file.type,
              size: file.size,
              path: file.path,
            },
          ]
        : []
    )
    store.setDraft(key, { ...(store.drafts[key] ?? { text: '' }), fileAttachments })
  }, [key, files.attachedFiles])

  const write = (next: { text?: string; contexts?: ChatContext[] }) => {
    const store = useMothershipDraftsStore.getState()
    const current = store.drafts[key] ?? { text: '' }
    store.setDraft(key, { ...current, ...next })
  }

  const unscopedSkills = new Map<string, string | null>()
  for (const skill of skills ?? []) {
    if (skill.context?.kind === 'skill') {
      const id = skill.context.skillId
      unscopedSkills.set(id, unscopedSkills.has(id) ? null : skill.id)
    }
  }
  const attachments: ChatAttachment[] = [
    ...files.attachedFiles.map(
      (file): ChatAttachment => ({
        id: file.id,
        name: file.name,
        metadata: file.uploading ? 'Uploading' : file.type || 'File',
        kind: attachmentKind(file.type),
        source: file.previewUrl,
        uploading: file.uploading,
        upload: file.key
          ? {
              id: file.id,
              key: file.key,
              filename: file.name,
              media_type: file.type,
              size: file.size,
              path: file.path,
            }
          : undefined,
      })
    ),
    ...contexts.map(
      (context, index): ChatAttachment => ({
        id: contextId(context, index),
        referenceId: selectedReferenceId(context, unscopedSkills),
        name: context.label,
        metadata: context.kind,
        kind: 'reference',
        context,
      })
    ),
  ]

  const settings = useComposerSettings(requestMode, chatId, onPlanChange)
  const textRef = useRef(text)
  textRef.current = text
  const voice = useVoiceInput({
    organizationId: organization.id,
    getValue: () => textRef.current,
    onChange: (value) => write({ text: value }),
  })

  const addFiles = (items: File[]) => {
    if (assistant) {
      if (items.some((file) => !isAssistantImageType(file.type))) {
        toast.error('Assistant accepts images only.')
        return
      }
      try {
        assertMultiFileUploadAdmission([...files.attachedFiles, ...items], {
          maxFiles: ASSISTANT_IMAGE_MAX_COUNT,
          maxFileBytes: ASSISTANT_IMAGE_MAX_BYTES,
          maxTotalBytes: ASSISTANT_IMAGE_MAX_TOTAL_BYTES,
        })
      } catch (error) {
        toast.error(getErrorMessage(error, 'Check the attached images before sending.'))
        return
      }
    }
    const list = new DataTransfer()
    for (const file of items) list.items.add(file)
    void files.processFiles(list.files)
  }

  return {
    draft: { text, attachments },
    referencesDisabled: assistant,
    setText: (value, changes) => {
      if (!changes?.add?.length && !changes?.remove?.length) {
        write({ text: value })
        return
      }
      const removed = new Set(changes.remove)
      const current = useMothershipDraftsStore.getState().drafts[key]?.contexts ?? contexts
      const kept = current.filter((context, index) => !removed.has(contextId(context, index)))
      const added = (changes.add ?? []).flatMap((item) => item.context ?? [])
      write({ text: value, contexts: [...kept, ...added] })
    },
    addFiles,
    addPastedText: (value) => {
      const file = new File([value], `pasted-${generateId().slice(0, 8)}.txt`, {
        type: 'text/plain',
      })
      addFiles([file])
    },
    removeAttachment: (id) => {
      if (id.startsWith('context:')) {
        write({ contexts: contexts.filter((context, index) => contextId(context, index) !== id) })
        return
      }
      files.removeFile(id)
    },
    clear: () => {
      useMothershipDraftsStore.getState().clearDraft(key)
      files.clearAttachedFiles()
    },
    restore: ({ text: restored, files: restoredFiles, contexts: restoredContexts }) => {
      write({ text: restored, contexts: restoredContexts })
      files.restoreAttachedFiles(
        restoredFiles.map((file) => ({
          id: file.id,
          key: file.key,
          name: file.filename,
          type: file.media_type,
          size: file.size,
          path:
            file.path ||
            getMothershipAttachmentPreviewUrl(file) ||
            getMothershipAttachmentUrl(file),
          previewUrl: getMothershipAttachmentPreviewUrl(file),
          uploading: false,
        }))
      )
    },
    references,
    referencesLoading,
    skillsLoading,
    skills,
    onPickerOpen: () => setPickerOpened(true),
    settings,
    accept: assistant ? ASSISTANT_ACCEPT : undefined,
    voice: voice.isSupported
      ? { listening: voice.isListening, toggle: voice.toggleListening }
      : undefined,
    drop: {
      dragging: files.isDragging,
      onDragEnter: files.handleDragEnter,
      onDragOver: files.handleDragOver,
      onDragLeave: files.handleDragLeave,
      onDrop: files.handleDrop,
    },
  }
}

/**
 * What the viewer can reference from this organization. Each row carries its owning workspace;
 * each picker stays pending until every workspace has supplied its part of that list.
 */
function useOrganizationInventory(enabled: boolean, organizationId: string) {
  const workspaceQuery = useWorkspacesQuery(enabled)
  const owned =
    enabled && !workspaceQuery.isPlaceholderData
      ? (workspaceQuery.data ?? []).filter(
          (workspace) => workspace.organizationId === organizationId
        )
      : []
  const workflows = useQueries({
    queries: owned.map((workspace) => getWorkflowListQueryOptions(workspace.id)),
  })
  const skillQueries = useQueries({
    queries: owned.map((workspace) => getSkillsQueryOptions(workspace.id)),
  })
  const references: ComposerReferences = [
    {
      group: 'Workspaces',
      items: owned.map(({ id, name }) => ({
        id,
        name,
        workspaceId: id,
        context: { kind: 'workspace', workspaceId: id, label: name },
      })),
    },
    {
      group: 'Workflows',
      items: owned.flatMap((workspace, index) =>
        (workflows[index]?.data ?? []).map((workflow) => ({
          id: `${workspace.id}:${workflow.id}`,
          name: workflow.name,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          context: {
            kind: 'workflow',
            workflowId: workflow.id,
            label: workflow.name,
            workspaceId: workspace.id,
          } satisfies ChatContext,
        }))
      ),
    },
  ]
  const skills: NonNullable<ComposerController['skills']>[number][] = []
  const builtins = new Set<string>()
  for (const [index, workspace] of owned.entries()) {
    const query = skillQueries[index]
    if (query?.isPlaceholderData) continue
    for (const skill of query?.data ?? []) {
      if (skill.readOnly && builtins.has(skill.id)) continue
      if (skill.readOnly) builtins.add(skill.id)
      const workspaceId = skill.readOnly ? undefined : workspace.id
      skills.push({
        id: workspaceId ? `${workspaceId}:${skill.id}` : skill.id,
        name: skill.name,
        detail: skill.description,
        workspaceId,
        workspaceName: workspaceId ? workspace.name : undefined,
        context: { kind: 'skill', skillId: skill.id, label: skill.name, workspaceId },
      })
    }
  }
  const loadingWorkspaces =
    enabled && (workspaceQuery.isPending || workspaceQuery.isPlaceholderData)
  return {
    references,
    skills,
    referencesLoading: loadingWorkspaces || workflows.some((query) => query.isPending),
    skillsLoading:
      loadingWorkspaces || skillQueries.some((query) => query.isPending || query.isPlaceholderData),
  }
}

/** Home's Build entry: hand the draft to a new chat surface, which sends it on mount. */
function useLiveStartChat() {
  const { organization } = useOrganization()
  const router = useRouter()
  return (draft: ComposerDraft): false | undefined => {
    if (draft.attachments.some((attachment) => attachment.uploading)) return false
    const { files, contexts } = draftToSend(draft)
    if (!draft.text && !files.length) return false
    const stored = MothershipHandoffStorage.store(
      {
        message: draft.text,
        ...(files.length ? { fileAttachments: files } : {}),
        contexts,
        requestMode: 'agent',
      },
      { organizationId: organization.id }
    )
    if (!stored) return false
    router.push('/chat')
    return undefined
  }
}

export const LIVE_COMPOSER_HOST: ComposerHost = {
  useComposer: useLiveComposer,
  useStartChat: useLiveStartChat,
  useStartSearch,
}
