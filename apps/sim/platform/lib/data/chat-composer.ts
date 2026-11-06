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

/**
 * A draft persisted per viewer and chat through the legacy drafts store, with uploads through the
 * legacy attachment hook, so a reload and the upload rules behave the same.
 */
export function useLiveComposer({
  draftKey,
  requestMode = 'agent',
  chatId,
  onPlanChange,
}: ComposerOptions & { onPlanChange?: (active: boolean) => void }): ComposerController {
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
  const references = useOrganizationReferences(inventoryEnabled)
  const skills = useOrganizationSkills(inventoryEnabled)
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
    setText: (value) => write({ text: value }),
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
    addReference: (_group, item) => {
      if (!item.context) return
      write({
        text: text === '/' ? '' : text,
        contexts: [...contexts, item.context],
      })
    },
    clear: () => {
      useMothershipDraftsStore.getState().clearDraft(key)
      files.clearAttachedFiles()
    },
    references,
    listsOnlyLoadedGroups: true,
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

function useOwnedWorkspaces(enabled: boolean) {
  const { organization } = useOrganization()
  const { data: workspaces = [] } = useWorkspacesQuery(enabled)
  return enabled ? workspaces.filter((item) => item.organizationId === organization.id) : []
}

/**
 * What the viewer can reference from this organization's workspaces. Each row carries the owning
 * workspace, since an organization chat has no workspace of its own to resolve it against.
 */
function useOrganizationReferences(enabled: boolean): ComposerReferences {
  const owned = useOwnedWorkspaces(enabled)
  const workflows = useQueries({
    queries: owned.map((workspace) => getWorkflowListQueryOptions(workspace.id)),
  })
  return [
    {
      group: 'Workflows',
      items: owned.flatMap((workspace, index) =>
        (workflows[index]?.data ?? []).map((workflow) => ({
          id: `${workspace.id}:${workflow.id}`,
          name: workflow.name,
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
}

/** Skills in the viewer's workspaces of this organization, as the `/` menu reads them. */
function useOrganizationSkills(enabled: boolean): ComposerController['skills'] {
  const owned = useOwnedWorkspaces(enabled)
  const queries = useQueries({
    queries: owned.map((workspace) => getSkillsQueryOptions(workspace.id)),
  })
  return owned.flatMap((workspace, index) =>
    (queries[index]?.isPlaceholderData ? [] : (queries[index]?.data ?? [])).map((skill) => ({
      id: `${workspace.id}:${skill.id}`,
      name: skill.name,
      context: { kind: 'skill', skillId: skill.id, label: skill.name } satisfies ChatContext,
    }))
  )
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
