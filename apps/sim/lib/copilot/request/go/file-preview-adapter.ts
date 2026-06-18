import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'
import {
  createFilePreviewSession,
  type FilePreviewContentMode,
  type FilePreviewSession,
  type FilePreviewTargetKind,
  isToolArgsDeltaStreamEvent,
  isToolCallStreamEvent,
  isToolResultStreamEvent,
  type SyntheticFilePreviewPayload,
  upsertFilePreviewSession,
} from '@/lib/copilot/request/session'
import type {
  ActiveFileIntent,
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
} from '@/lib/copilot/request/types'
import { peekFileIntent } from '@/lib/copilot/tools/server/files/file-intent-store'
import {
  buildFilePreviewText,
  loadWorkspaceFileTextForPreview,
} from '@/lib/copilot/tools/server/files/file-preview'
import { resolveWorkspaceFileReference } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('CopilotFilePreviewAdapter')

type JsonRecord = Record<string, unknown>
type FileIntent = ActiveFileIntent

type EditContentStreamState = {
  raw: string
  lastContentSnapshot?: string
}

type FilePreviewStreamState = {
  session: FilePreviewSession
  lastEmittedPreviewText: string
  lastSnapshotAt: number
}

type ParsedWorkspaceFileArgs = {
  operation: string
  target: FileIntent['target']
  title?: string
  contentType?: string
  edit?: JsonRecord
}

const PATCH_PREVIEW_SNAPSHOT_INTERVAL_MS = 80
const DELTA_PREVIEW_CHECKPOINT_INTERVAL_MS = 1000

function asJsonRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}

function toPreviewTargetKind(kind: string | undefined): FilePreviewTargetKind | undefined {
  return kind === 'new_file' || kind === 'file_id' ? kind : undefined
}

async function resolvePreviewTarget(args: {
  workspaceId?: string
  target: FileIntent['target']
}): Promise<FileIntent['target']> {
  if (args.target.kind !== 'path' || !args.workspaceId || !args.target.path) {
    return args.target
  }

  const file = await resolveWorkspaceFileReference(args.workspaceId, args.target.path)
  if (!file) {
    return args.target
  }

  return {
    kind: 'file_id',
    fileId: file.id,
    fileName: args.target.fileName ?? file.name,
    path: args.target.path,
  }
}

function parseWorkspaceFileArgs(value: unknown): ParsedWorkspaceFileArgs | undefined {
  const args = asJsonRecord(value)
  if (!args) {
    return undefined
  }

  const operation = typeof args.operation === 'string' ? args.operation : undefined
  const target = asJsonRecord(args.target)
  const targetKind = typeof target?.kind === 'string' ? target.kind : undefined
  if (!operation || !target || !targetKind) {
    return undefined
  }

  const fileId = typeof target.fileId === 'string' ? target.fileId : undefined
  const fileName = typeof target.fileName === 'string' ? target.fileName : undefined
  const path = typeof target.path === 'string' ? target.path : undefined
  const title = typeof args.title === 'string' ? args.title : undefined
  const contentType = typeof args.contentType === 'string' ? args.contentType : undefined
  const edit = asJsonRecord(args.edit)

  return {
    operation,
    target: {
      kind: targetKind,
      ...(fileId ? { fileId } : {}),
      ...(fileName ? { fileName } : {}),
      ...(path ? { path } : {}),
    },
    ...(title ? { title } : {}),
    ...(contentType ? { contentType } : {}),
    ...(edit ? { edit } : {}),
  }
}

function extractWorkspaceFileResult(output: unknown): { fileId?: string; fileName?: string } {
  const candidates: JsonRecord[] = []
  const root = asJsonRecord(output)
  if (root) {
    candidates.push(root)
    const rootData = asJsonRecord(root.data)
    if (rootData) candidates.push(rootData)
    const rootOutput = asJsonRecord(root.output)
    if (rootOutput) {
      candidates.push(rootOutput)
      const outputData = asJsonRecord(rootOutput.data)
      if (outputData) candidates.push(outputData)
    }
  }

  for (const candidate of candidates) {
    const fileId =
      typeof candidate.id === 'string'
        ? candidate.id
        : typeof candidate.fileId === 'string'
          ? candidate.fileId
          : undefined
    if (!fileId) continue

    const fileName =
      typeof candidate.name === 'string'
        ? candidate.name
        : typeof candidate.fileName === 'string'
          ? candidate.fileName
          : undefined
    return { fileId, fileName }
  }
  return {}
}

export function decodeJsonStringPrefix(input: string): string {
  let output = ''
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch !== '\\') {
      output += ch
      continue
    }
    const next = input[i + 1]
    if (!next) break
    if (next === 'n') {
      output += '\n'
      i++
      continue
    }
    if (next === 't') {
      output += '\t'
      i++
      continue
    }
    if (next === 'r') {
      output += '\r'
      i++
      continue
    }
    if (next === '"') {
      output += '"'
      i++
      continue
    }
    if (next === '\\') {
      output += '\\'
      i++
      continue
    }
    if (next === '/') {
      output += '/'
      i++
      continue
    }
    if (next === 'b') {
      output += '\b'
      i++
      continue
    }
    if (next === 'f') {
      output += '\f'
      i++
      continue
    }
    if (next === 'u') {
      const hex = input.slice(i + 2, i + 6)
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) break
      output += String.fromCharCode(Number.parseInt(hex, 16))
      i += 5
      continue
    }
    break
  }
  return output
}

export function extractEditContent(raw: string): string {
  const marker = '"content":'
  const idx = raw.indexOf(marker)
  if (idx === -1) return ''
  const rest = raw.slice(idx + marker.length).trimStart()
  if (!rest.startsWith('"')) return rest
  let end = -1
  for (let i = 1; i < rest.length; i++) {
    if (rest[i] === '\\') {
      i++
      continue
    }
    if (rest[i] === '"') {
      end = i
      break
    }
  }
  const inner = end === -1 ? rest.slice(1) : rest.slice(1, end)
  return decodeJsonStringPrefix(inner)
}

function isContentOperation(
  operation: string | undefined
): operation is 'append' | 'update' | 'patch' {
  return operation === 'append' || operation === 'update' || operation === 'patch'
}

function isDocFormat(fileName: string | undefined): boolean {
  return /\.(pptx|docx|pdf)$/i.test(fileName ?? '')
}

function buildPreviewSessionFromIntent(
  streamId: string,
  intent: FileIntent,
  current?: FilePreviewSession
): FilePreviewSession {
  const targetKind = toPreviewTargetKind(intent.target.kind)

  return createFilePreviewSession({
    streamId,
    toolCallId: intent.toolCallId,
    fileName: intent.target.fileName ?? current?.fileName,
    ...(intent.target.fileId ? { fileId: intent.target.fileId } : {}),
    ...(targetKind ? { targetKind } : {}),
    operation: intent.operation,
    ...(intent.edit ? { edit: intent.edit } : {}),
    ...(typeof current?.baseContent === 'string' ? { baseContent: current.baseContent } : {}),
    previewText: current?.previewText ?? '',
    previewVersion: current?.previewVersion ?? 0,
    status: current?.status ?? 'pending',
    completedAt: current?.completedAt,
  })
}

async function persistFilePreviewSession(session: FilePreviewSession): Promise<void> {
  try {
    await upsertFilePreviewSession(session)
  } catch (error) {
    logger.warn('Failed to persist file preview session', {
      streamId: session.streamId,
      toolCallId: session.toolCallId,
      previewVersion: session.previewVersion,
      error: toError(error).message,
    })
  }
}

export function buildPreviewContentUpdate(
  previousText: string,
  nextText: string,
  lastSnapshotAt: number,
  now: number,
  operation: string | undefined
): { content: string; contentMode: FilePreviewContentMode; lastSnapshotAt: number } {
  const shouldForceSnapshot =
    previousText.length === 0 ||
    !nextText.startsWith(previousText) ||
    operation === 'patch' ||
    operation === 'append' ||
    now - lastSnapshotAt >= DELTA_PREVIEW_CHECKPOINT_INTERVAL_MS

  if (shouldForceSnapshot) {
    return {
      content: nextText,
      contentMode: 'snapshot',
      lastSnapshotAt: now,
    }
  }

  return {
    content: nextText.slice(previousText.length),
    contentMode: 'delta',
    lastSnapshotAt,
  }
}

export interface FilePreviewAdapterState {
  editContentState: Map<string, EditContentStreamState>
  filePreviewState: Map<string, FilePreviewStreamState>
}

export function createFilePreviewAdapterState(): FilePreviewAdapterState {
  return {
    editContentState: new Map<string, EditContentStreamState>(),
    filePreviewState: new Map<string, FilePreviewStreamState>(),
  }
}

async function emitPreviewEvent(
  streamEvent: StreamEvent,
  options: Pick<OrchestratorOptions, 'onEvent'>,
  payload: SyntheticFilePreviewPayload
): Promise<void> {
  await options.onEvent?.({
    type: MothershipStreamV1EventType.tool,
    payload,
    ...(streamEvent.scope ? { scope: streamEvent.scope } : {}),
  })
}

export async function processFilePreviewStreamEvent(input: {
  streamId: string
  streamEvent: StreamEvent
  context: StreamingContext
  execContext: ExecutionContext
  options: Pick<OrchestratorOptions, 'onEvent'>
  state: FilePreviewAdapterState
}): Promise<void> {
  const { streamId, streamEvent, context, execContext, options, state } = input
  const { editContentState, filePreviewState } = state

  // Scope the in-flight intent to the invoking file subagent's channel (its
  // outer tool_use id) so two file agents streaming concurrently never read or
  // overwrite each other's intent. workspace_file and edit_content from the same
  // file agent share this channel id, so they pair up; siblings stay isolated.
  const channelId = streamEvent.scope?.parentToolCallId ?? ''
  const getIntent = (): FileIntent | null => context.activeFileIntents.get(channelId) ?? null
  const setIntent = (intent: FileIntent): void => {
    context.activeFileIntents.set(channelId, intent)
  }
  const clearIntent = (): void => {
    context.activeFileIntents.delete(channelId)
  }

  if (isToolCallStreamEvent(streamEvent) && streamEvent.payload.toolName === 'workspace_file') {
    const toolCallId = streamEvent.payload.toolCallId
    const parsedArgs = parseWorkspaceFileArgs(streamEvent.payload.arguments)
    if (toolCallId && parsedArgs) {
      const { operation, title, contentType, edit } = parsedArgs
      const target = await resolvePreviewTarget({
        workspaceId: execContext.workspaceId,
        target: parsedArgs.target,
      })
      const previewTargetKind = toPreviewTargetKind(target.kind)
      const { fileId, fileName } = target

      const isContentOp = isContentOperation(operation)
      // Per-channel: a re-declared workspace_file just overwrites THIS channel's
      // slot. No cross-message intent clearing — that would wipe a concurrent
      // sibling file agent's pending intent.
      const intent: FileIntent = {
        toolCallId,
        operation,
        target,
        ...(title ? { title } : {}),
        ...(contentType ? { contentType } : {}),
        ...(edit ? { edit } : {}),
      }
      setIntent(intent)

      if (isContentOp && previewTargetKind) {
        let previewBaseContent: string | undefined
        if (
          execContext.workspaceId &&
          fileId &&
          (operation === 'append' || operation === 'patch')
        ) {
          previewBaseContent = await loadWorkspaceFileTextForPreview(
            execContext.workspaceId,
            fileId
          )
        }

        let session = buildPreviewSessionFromIntent(streamId, intent)
        if (previewBaseContent !== undefined) {
          session = { ...session, baseContent: previewBaseContent }
        }
        filePreviewState.set(toolCallId, {
          session,
          lastEmittedPreviewText: '',
          lastSnapshotAt: 0,
        })
        await persistFilePreviewSession(session)

        await emitPreviewEvent(streamEvent, options, {
          toolCallId,
          toolName: 'workspace_file',
          previewPhase: 'file_preview_start',
        })
        await emitPreviewEvent(streamEvent, options, {
          toolCallId,
          toolName: 'workspace_file',
          previewPhase: 'file_preview_target',
          operation,
          target: {
            kind: previewTargetKind,
            ...(fileId ? { fileId } : {}),
            ...(fileName ? { fileName } : {}),
          },
          ...(title ? { title } : {}),
        })
        if (edit) {
          await emitPreviewEvent(streamEvent, options, {
            toolCallId,
            toolName: 'workspace_file',
            previewPhase: 'file_preview_edit_meta',
            edit,
          })
        }
      }
    }
  }

  const workspaceResultIntent = getIntent()
  if (
    isToolResultStreamEvent(streamEvent) &&
    streamEvent.payload.toolName === 'workspace_file' &&
    workspaceResultIntent &&
    isContentOperation(workspaceResultIntent.operation)
  ) {
    const result = extractWorkspaceFileResult(streamEvent.payload.output)
    if (result.fileId && workspaceResultIntent.target.kind === 'path') {
      const intent: FileIntent = {
        ...workspaceResultIntent,
        target: {
          kind: 'file_id',
          fileId: result.fileId,
          fileName: result.fileName ?? workspaceResultIntent.target.fileName,
          path: workspaceResultIntent.target.path,
        },
      }
      setIntent(intent)

      let previewBaseContent: string | undefined
      if (
        execContext.workspaceId &&
        (intent.operation === 'append' || intent.operation === 'patch')
      ) {
        previewBaseContent = await loadWorkspaceFileTextForPreview(
          execContext.workspaceId,
          result.fileId
        )
      }

      let session = buildPreviewSessionFromIntent(streamId, intent)
      if (previewBaseContent !== undefined) {
        session = { ...session, baseContent: previewBaseContent }
      }
      filePreviewState.set(intent.toolCallId, {
        session,
        lastEmittedPreviewText: '',
        lastSnapshotAt: 0,
      })
      await persistFilePreviewSession(session)

      await emitPreviewEvent(streamEvent, options, {
        toolCallId: intent.toolCallId,
        toolName: 'workspace_file',
        previewPhase: 'file_preview_start',
      })
      await emitPreviewEvent(streamEvent, options, {
        toolCallId: intent.toolCallId,
        toolName: 'workspace_file',
        previewPhase: 'file_preview_target',
        operation: intent.operation,
        target: {
          kind: 'file_id',
          fileId: result.fileId,
          ...(result.fileName ? { fileName: result.fileName } : {}),
        },
        ...(intent.title ? { title: intent.title } : {}),
      })
      if (intent.edit) {
        await emitPreviewEvent(streamEvent, options, {
          toolCallId: intent.toolCallId,
          toolName: 'workspace_file',
          previewPhase: 'file_preview_edit_meta',
          edit: intent.edit,
        })
      }
    }
  }

  const patchDeleteIntent = getIntent()
  if (
    isToolResultStreamEvent(streamEvent) &&
    streamEvent.payload.toolName === 'workspace_file' &&
    patchDeleteIntent &&
    isContentOperation(patchDeleteIntent.operation) &&
    patchDeleteIntent.operation === 'patch' &&
    patchDeleteIntent.edit?.strategy === 'anchored' &&
    patchDeleteIntent.edit?.mode === 'delete_between' &&
    execContext.workspaceId &&
    patchDeleteIntent.target.fileId &&
    !isDocFormat(patchDeleteIntent.target.fileName)
  ) {
    const currentPreview = filePreviewState.get(patchDeleteIntent.toolCallId)
    const previewText = buildFilePreviewText({
      operation: 'patch',
      streamedContent: '',
      existingContent: currentPreview?.session.baseContent,
      edit: currentPreview?.session.edit,
    })

    if (previewText !== undefined) {
      const baseSession = buildPreviewSessionFromIntent(
        streamId,
        patchDeleteIntent,
        currentPreview?.session
      )
      const nextSession: FilePreviewSession = {
        ...baseSession,
        status: 'streaming',
        previewText,
        previewVersion: (currentPreview?.session.previewVersion ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      }
      filePreviewState.set(patchDeleteIntent.toolCallId, {
        session: nextSession,
        lastEmittedPreviewText: previewText,
        lastSnapshotAt: Date.now(),
      })
      await persistFilePreviewSession(nextSession)
      await emitPreviewEvent(streamEvent, options, {
        toolCallId: nextSession.toolCallId,
        toolName: 'workspace_file',
        previewPhase: 'file_preview_content',
        content: previewText,
        contentMode: 'snapshot',
        previewVersion: nextSession.previewVersion,
        fileName: nextSession.fileName,
        ...(nextSession.fileId ? { fileId: nextSession.fileId } : {}),
        ...(nextSession.targetKind ? { targetKind: nextSession.targetKind } : {}),
        ...(nextSession.operation ? { operation: nextSession.operation } : {}),
        ...(nextSession.edit ? { edit: nextSession.edit } : {}),
      })
    }
  }

  if (isToolArgsDeltaStreamEvent(streamEvent) && streamEvent.payload.toolName === 'edit_content') {
    const toolCallId = streamEvent.payload.toolCallId
    const delta = streamEvent.payload.argumentsDelta
    const stateForTool = editContentState.get(toolCallId) ?? { raw: '' }
    stateForTool.raw += delta

    const editIntent = getIntent()
    if (editIntent) {
      const streamedContent = extractEditContent(stateForTool.raw)
      if (streamedContent !== (stateForTool.lastContentSnapshot ?? '')) {
        stateForTool.lastContentSnapshot = streamedContent
        let currentPreview = filePreviewState.get(editIntent.toolCallId) ?? {
          session: buildPreviewSessionFromIntent(streamId, editIntent),
          lastEmittedPreviewText: '',
          lastSnapshotAt: 0,
        }

        if (
          currentPreview.session.baseContent === undefined &&
          (editIntent.operation === 'append' || editIntent.operation === 'patch') &&
          execContext.workspaceId &&
          editIntent.target.fileId
        ) {
          const intentBase = await peekFileIntent(
            execContext.workspaceId,
            editIntent.target.fileId,
            {
              chatId: execContext.chatId,
              messageId: execContext.messageId,
              channelId,
            }
          )
          if (typeof intentBase?.existingContent === 'string') {
            const seededSession: FilePreviewSession = {
              ...currentPreview.session,
              baseContent: intentBase.existingContent,
              ...(intentBase.edit ? { edit: intentBase.edit } : {}),
            }
            currentPreview = {
              ...currentPreview,
              session: seededSession,
            }
            filePreviewState.set(editIntent.toolCallId, currentPreview)
            await persistFilePreviewSession(seededSession)
          }
        }

        const previewText = isContentOperation(editIntent.operation)
          ? buildFilePreviewText({
              operation: editIntent.operation,
              streamedContent,
              existingContent: currentPreview.session.baseContent,
              edit: currentPreview.session.edit,
            })
          : undefined

        if (previewText !== undefined) {
          const baseSession = buildPreviewSessionFromIntent(
            streamId,
            editIntent,
            currentPreview.session
          )
          const now = Date.now()
          const nextSession: FilePreviewSession = {
            ...baseSession,
            status: 'streaming',
            previewText,
            previewVersion: (currentPreview.session.previewVersion ?? 0) + 1,
            updatedAt: new Date(now).toISOString(),
          }

          await persistFilePreviewSession(nextSession)

          if (
            nextSession.operation === 'patch' &&
            now - currentPreview.lastSnapshotAt < PATCH_PREVIEW_SNAPSHOT_INTERVAL_MS
          ) {
            filePreviewState.set(editIntent.toolCallId, {
              session: nextSession,
              lastEmittedPreviewText: currentPreview.lastEmittedPreviewText,
              lastSnapshotAt: currentPreview.lastSnapshotAt,
            })
          } else {
            const previewUpdate = buildPreviewContentUpdate(
              currentPreview.lastEmittedPreviewText,
              nextSession.previewText,
              currentPreview.lastSnapshotAt,
              now,
              nextSession.operation
            )

            filePreviewState.set(editIntent.toolCallId, {
              session: nextSession,
              lastEmittedPreviewText: nextSession.previewText,
              lastSnapshotAt: previewUpdate.lastSnapshotAt,
            })

            await emitPreviewEvent(streamEvent, options, {
              toolCallId: nextSession.toolCallId,
              toolName: 'workspace_file',
              previewPhase: 'file_preview_content',
              content: previewUpdate.content,
              contentMode: previewUpdate.contentMode,
              previewVersion: nextSession.previewVersion,
              fileName: nextSession.fileName,
              ...(nextSession.fileId ? { fileId: nextSession.fileId } : {}),
              ...(nextSession.targetKind ? { targetKind: nextSession.targetKind } : {}),
              ...(nextSession.operation ? { operation: nextSession.operation } : {}),
              ...(nextSession.edit ? { edit: nextSession.edit } : {}),
            })
          }
        } else {
          filePreviewState.set(editIntent.toolCallId, {
            session: currentPreview.session,
            lastEmittedPreviewText: currentPreview.lastEmittedPreviewText,
            lastSnapshotAt: currentPreview.lastSnapshotAt,
          })
        }
      }
    }

    editContentState.set(toolCallId, stateForTool)
  }

  if (isToolCallStreamEvent(streamEvent) && streamEvent.payload.toolName === 'edit_content') {
    const toolCallId = streamEvent.payload.toolCallId
    if (toolCallId) {
      editContentState.delete(toolCallId)
    }
  }

  const editResultIntent = getIntent()
  if (
    isToolResultStreamEvent(streamEvent) &&
    streamEvent.payload.toolName === 'edit_content' &&
    editResultIntent
  ) {
    const currentPreview = filePreviewState.get(editResultIntent.toolCallId)
    const completedAt = new Date().toISOString()

    if (
      currentPreview &&
      currentPreview.lastEmittedPreviewText !== currentPreview.session.previewText &&
      currentPreview.session.previewText.length > 0
    ) {
      filePreviewState.set(editResultIntent.toolCallId, {
        session: currentPreview.session,
        lastEmittedPreviewText: currentPreview.session.previewText,
        lastSnapshotAt: Date.now(),
      })
      await emitPreviewEvent(streamEvent, options, {
        toolCallId: currentPreview.session.toolCallId,
        toolName: 'workspace_file',
        previewPhase: 'file_preview_content',
        content: currentPreview.session.previewText,
        contentMode: 'snapshot',
        previewVersion: currentPreview.session.previewVersion,
        fileName: currentPreview.session.fileName,
        ...(currentPreview.session.fileId ? { fileId: currentPreview.session.fileId } : {}),
        ...(currentPreview.session.targetKind
          ? { targetKind: currentPreview.session.targetKind }
          : {}),
        ...(currentPreview.session.operation
          ? { operation: currentPreview.session.operation }
          : {}),
        ...(currentPreview.session.edit ? { edit: currentPreview.session.edit } : {}),
      })
    }

    if (currentPreview) {
      const completedSession: FilePreviewSession = {
        ...currentPreview.session,
        status: 'complete',
        updatedAt: completedAt,
        completedAt,
      }
      filePreviewState.set(editResultIntent.toolCallId, {
        session: completedSession,
        lastEmittedPreviewText: completedSession.previewText,
        lastSnapshotAt: Date.now(),
      })
      await persistFilePreviewSession(completedSession)
    }

    await emitPreviewEvent(streamEvent, options, {
      toolCallId: editResultIntent.toolCallId,
      toolName: 'workspace_file',
      previewPhase: 'file_preview_complete',
      fileId: editResultIntent.target.fileId,
      output: streamEvent.payload.output,
      ...(currentPreview ? { previewVersion: currentPreview.session.previewVersion } : {}),
    })
    clearIntent()
  }
}
