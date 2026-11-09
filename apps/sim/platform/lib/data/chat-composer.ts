'use client'

import { useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { useRouter } from 'next/navigation'
import { useFileAttachments } from '@/components/workflow-editor/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { useSession } from '@/lib/auth/client'
import { useFeatureFlag } from '@/lib/core/config/feature-flags-context'
import { BrowserStorage, MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { getMothershipAttachmentUrl } from '@/lib/mothership/chat/attachment-preview'
import { UNAVAILABLE_CONTEXT_NOTICE } from '@/lib/mothership/chat/context'
import type { FileAttachmentForApi } from '@/lib/mothership/chat/types'
import {
  MOTHERSHIP_ADD_CONTEXT_EVENT,
  type MothershipAddContextDetail,
} from '@/lib/mothership/events'
import {
  MOTHERSHIP_EFFORT_OPTIONS,
  MOTHERSHIP_MODEL_OPTIONS,
  MOTHERSHIP_SIMPLE_EFFORT_OPTIONS,
  type MothershipEffort,
  resolveMothershipModelSettings,
} from '@/lib/mothership/model-options'
import { toast } from '@/lib/toast/sink'
import { assertMultiFileUploadAdmission } from '@/lib/uploads/client/admission'
import {
  ASSISTANT_IMAGE_MAX_BYTES,
  ASSISTANT_IMAGE_MAX_COUNT,
  ASSISTANT_IMAGE_MAX_TOTAL_BYTES,
  isAssistantImageType,
} from '@/lib/uploads/shared/assistant-images'
import type {
  ChatAttachment,
  ComposerController,
  ComposerDraft,
  ComposerSettings,
} from '@/app/(product)/_components/composer/model'
import type {
  ComposerHost,
  ComposerOptions,
} from '@/app/(product)/_components/session/composer-host'
import {
  useMothershipChatHistory,
  useSetMothershipChatEffort,
} from '@/hooks/queries/mothership-chats'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { draftToSend } from '@/platform/lib/data/chat-draft'
import { useMentionInventory } from '@/platform/lib/data/chat-mentions'
import { useOrganization } from '@/platform/lib/data/organization'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { useStartSearch } from '@/platform/lib/data/search-start'
import { attachmentKind } from '@/platform/shared/attachment-kind'
import { readDraft, useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import {
  useMothershipEffortStore,
  useMothershipPlanEffortStore,
} from '@/stores/mothership-effort/store'
import type { ChatContext } from '@/stores/panel'

const ASSISTANT_ACCEPT = 'image/*'
/** Where the legacy organization chat remembered the viewer's last mode. */
const LEGACY_CHAT_MODE_STORAGE = 'organization-chat-mode'

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
  if (context.kind === 'table' && context.workspaceId)
    return `${context.workspaceId}:${context.tableId}`
  if (context.kind === 'file' && context.workspaceId)
    return `${context.workspaceId}:${context.fileId}`
  if (context.kind === 'knowledge' && context.workspaceId && context.knowledgeId)
    return `${context.workspaceId}:${context.knowledgeId}`
  if (context.kind === 'past_chat' && context.workspaceId)
    return `${context.workspaceId}:${context.chatId}`
  if (context.kind === 'logs' && context.workspaceId && context.executionId)
    return `${context.workspaceId}:${context.executionId}`
  if (context.kind === 'folder' && context.workspaceId)
    return `${context.workspaceId}:${context.folderId}`
  if (context.kind === 'filefolder' && context.workspaceId)
    return `${context.workspaceId}:${context.fileFolderId}`
  if (context.kind === 'dashboard' && context.workspaceId)
    return `${context.workspaceId}:${context.dashboardId}`
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

/**
 * Before Home and Search's Assistant kept separate drafts, both kept one unsent draft under the `new`
 * slot, owned by whichever mode the viewer last chose. Returns that key when it holds a draft for
 * this composer's mode, so the draft moves here instead of being stranded.
 */
function legacySharedDraftKey(
  userId: string,
  organizationId: string,
  { assistant, canBuild }: { assistant: boolean; canBuild: boolean }
): string | null {
  const key = `${userId}:organization:${organizationId}:new`
  if (!useMothershipDraftsStore.getState().drafts[key]) return null
  const persisted = toRecord(BrowserStorage.getItem<unknown>(LEGACY_CHAT_MODE_STORAGE, null))
  const modes = toRecord(toRecord(persisted.state).modes)
  const legacyAssistant = !canBuild || modes[`${userId}:${organizationId}`] === 'assistant'
  return legacyAssistant === assistant ? key : null
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
  const { organization, canBuild } = useOrganization()
  const { data: session } = useSession()
  const userId = session?.user?.id
  const assistant = requestMode === 'assistant'
  const key = `${userId}:organization:${organization.id}:${draftKey}`
  const [initialKey] = useState(key)
  const [legacyKey] = useState(() =>
    chatId || !userId
      ? null
      : legacySharedDraftKey(userId, organization.id, {
          assistant,
          canBuild,
        })
  )
  const saved = useMothershipDraftsStore((state) =>
    readDraft(state.drafts, legacyKey ? [key, initialKey, legacyKey] : [key, initialKey])
  )
  const [initial] = useState(() =>
    readDraft(useMothershipDraftsStore.getState().drafts, legacyKey ? [key, legacyKey] : [key])
  )
  useEffect(() => {
    const store = useMothershipDraftsStore.getState()
    if (legacyKey) store.migrateDraft(legacyKey, initialKey)
    if (initialKey !== key) store.migrateDraft(initialKey, key)
  }, [initialKey, key, legacyKey])
  const [pickerOpened, setPickerOpened] = useState(false)
  const inventoryEnabled = !assistant && pickerOpened
  const [referenceSearch, setReferenceSearch] = useState('')
  const mentions = useMentionInventory(inventoryEnabled, organization.id, referenceSearch)
  const { references, referencesLoading, skills, skillsLoading } = mentions
  const files = useFileAttachments({
    userId,
    organizationId: organization.id,
    requestMode,
    initialAttachments: initial?.fileAttachments,
  })
  const contexts: ChatContext[] = saved?.contexts ?? []
  const text = saved?.text ?? ''

  // Add to chat from a terminal, the browser, a file or a table attaches its context to this draft,
  // as legacy's input claimed it. Claiming tells the producer a mounted composer took it.
  useEffect(() => {
    if (assistant) return
    const handleAddContext = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const detail: MothershipAddContextDetail = event.detail
      const incoming = detail.context ? [detail.context] : detail.contexts
      if (!incoming?.length) return
      event.preventDefault()
      const store = useMothershipDraftsStore.getState()
      const current = store.drafts[key] ?? { text: '' }
      const present = new Set((current.contexts ?? []).map((context) => JSON.stringify(context)))
      const added = incoming.filter((context) => !present.has(JSON.stringify(context)))
      if (added.length)
        store.setDraft(key, { ...current, contexts: [...(current.contexts ?? []), ...added] })
    }
    window.addEventListener(MOTHERSHIP_ADD_CONTEXT_EVENT, handleAddContext)
    return () => window.removeEventListener(MOTHERSHIP_ADD_CONTEXT_EVENT, handleAddContext)
  }, [assistant, key])

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
    restore: (next) => {
      if (
        next.attachments.some(
          (attachment) => attachment.kind === 'reference' && !attachment.context
        )
      )
        toast.info(UNAVAILABLE_CONTEXT_NOTICE)
      write({ text: next.text, contexts: next.attachments.flatMap((item) => item.context ?? []) })
      files.restoreAttachedFiles(
        next.attachments.flatMap(({ upload, source }) =>
          upload
            ? [
                {
                  id: upload.id,
                  key: upload.key,
                  name: upload.filename,
                  type: upload.media_type,
                  size: upload.size,
                  path: getMothershipAttachmentUrl(upload),
                  uploading: false,
                  previewUrl: source,
                },
              ]
            : []
        )
      )
    },
    references,
    referencesLoading,
    skillsLoading,
    skills,
    onPickerOpen: () => setPickerOpened(true),
    onReferenceSearch: setReferenceSearch,
    browse: mentions.browse,
    onBrowseWorkspace: mentions.onBrowseWorkspace,
    onBrowseSearch: mentions.onBrowseSearch,
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

/** Home's Build entry: hand the draft to a new chat surface, which sends it on mount. */
function useLiveStartChat() {
  const surface = useOrganization()
  const { organization } = surface
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
    router.push(surfaceHref(surface, '/chat'))
    return undefined
  }
}

function useLiveAppendHomePrompt() {
  const { organization } = useOrganization()
  const { data: session } = useSession()
  const userId = session?.user?.id
  if (!userId) return null
  return (prompt: string) => {
    const key = `${userId}:organization:${organization.id}:home`
    const store = useMothershipDraftsStore.getState()
    const draft = store.drafts[key]
    store.setDraft(key, {
      ...draft,
      text: draft?.text ? `${draft.text}\n\n${prompt}` : prompt,
    })
  }
}

export const LIVE_COMPOSER_HOST: ComposerHost = {
  useComposer: useLiveComposer,
  useStartChat: useLiveStartChat,
  useStartSearch,
  useAppendHomePrompt: useLiveAppendHomePrompt,
}
