import { createLogger } from '@sim/logger'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import {
  type ElevenLabsSourceAudio,
  generateElevenLabsAudio,
} from '@/lib/internal/elevenlabs/client'
import { ElevenLabsOperationError } from '@/lib/internal/elevenlabs/errors'
import type {
  ElevenLabsAudioIsolationInput,
  ElevenLabsSoundEffectsInput,
  ElevenLabsSpeechToSpeechInput,
} from '@/lib/internal/elevenlabs/schema'
import { StorageService } from '@/lib/uploads'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import {
  isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { UserFile } from '@/executor/types'

const logger = createLogger('ElevenLabsOperations')

export interface ElevenLabsOperationContext {
  headers: Headers
  requestId: string
  signal?: AbortSignal
  userId: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

export interface ElevenLabsAudioResult {
  audioUrl: string
  audioFile?: UserFile
  size?: number
}

function validatePrivateModelInput(
  input: ElevenLabsSpeechToSpeechInput | ElevenLabsAudioIsolationInput,
  context: ElevenLabsOperationContext
): void {
  const provenance = validateOpaqueModelInputProvenance({
    headers: context.headers,
    payload: input,
    isInternalRequest: true,
  })
  if (!provenance.success) {
    throw new ElevenLabsOperationError(provenance.error, provenance.status)
  }
}

async function loadSourceAudio(
  file: UserFile,
  context: ElevenLabsOperationContext
): Promise<ElevenLabsSourceAudio> {
  context.signal?.throwIfAborted()
  const denied = await assertToolFileAccess(file.key, context.userId, context.requestId, logger)
  context.signal?.throwIfAborted()
  if (denied) {
    throw new ElevenLabsOperationError(
      'File not found',
      denied.status,
      (await denied.json()) as Record<string, unknown>
    )
  }
  if (!(await isModelSafeWorkspaceFileKey(file.key))) {
    throw new ElevenLabsOperationError(MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE, 400)
  }
  context.signal?.throwIfAborted()
  const buffer = await downloadFileFromStorage(file, context.requestId, logger, {
    maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
  })
  context.signal?.throwIfAborted()
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  return {
    buffer,
    fileName: file.name,
    mimeType: file.type || getMimeTypeFromExtension(extension),
  }
}

async function storeAudio(
  operation: 'sound_effects' | 'speech_to_speech' | 'audio_isolation',
  buffer: Buffer,
  context: ElevenLabsOperationContext
): Promise<ElevenLabsAudioResult> {
  context.signal?.throwIfAborted()
  const fileName = `elevenlabs-${operation}-${Date.now()}.mp3`
  if (context.workspaceId && context.workflowId && context.executionId) {
    const audioFile = await uploadExecutionFile(
      {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        executionId: context.executionId,
      },
      buffer,
      fileName,
      'audio/mpeg',
      context.userId
    )
    context.signal?.throwIfAborted()
    return { audioFile, audioUrl: audioFile.url }
  }

  const file = await StorageService.uploadFile({
    file: buffer,
    fileName,
    contentType: 'audio/mpeg',
    context: 'copilot',
  })
  context.signal?.throwIfAborted()
  return { audioUrl: `${getBaseUrl()}${file.path}`, size: file.size }
}

export async function executeElevenLabsSoundEffects(
  input: ElevenLabsSoundEffectsInput,
  context: ElevenLabsOperationContext
): Promise<ElevenLabsAudioResult> {
  if (!input.text) throw new ElevenLabsOperationError('text is required', 400)
  const buffer = await generateElevenLabsAudio(
    { operation: 'sound_effects', input },
    context.signal
  )
  return storeAudio('sound_effects', buffer, context)
}

export async function executeElevenLabsSpeechToSpeech(
  input: ElevenLabsSpeechToSpeechInput,
  context: ElevenLabsOperationContext
): Promise<ElevenLabsAudioResult> {
  validatePrivateModelInput(input, context)
  if (!input.audioFile) throw new ElevenLabsOperationError('audioFile is required', 400)
  const source = await loadSourceAudio(input.audioFile, context)
  if (!input.voiceId) throw new ElevenLabsOperationError('voiceId is required', 400)
  const validation = validateAlphanumericId(input.voiceId, 'voiceId', 255)
  if (!validation.isValid) {
    throw new ElevenLabsOperationError(validation.error || 'Invalid voiceId', 400)
  }
  const buffer = await generateElevenLabsAudio(
    { operation: 'speech_to_speech', input, source },
    context.signal
  )
  return storeAudio('speech_to_speech', buffer, context)
}

export async function executeElevenLabsAudioIsolation(
  input: ElevenLabsAudioIsolationInput,
  context: ElevenLabsOperationContext
): Promise<ElevenLabsAudioResult> {
  validatePrivateModelInput(input, context)
  if (!input.audioFile) throw new ElevenLabsOperationError('audioFile is required', 400)
  const source = await loadSourceAudio(input.audioFile, context)
  const buffer = await generateElevenLabsAudio(
    { operation: 'audio_isolation', input, source },
    context.signal
  )
  return storeAudio('audio_isolation', buffer, context)
}
