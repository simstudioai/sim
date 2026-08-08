import {
  applyProjectedModelVisibleFileNames,
  selectModelVisibleFileNames,
} from '@/lib/uploads/utils/model-input'

/** Selects the filename serialized into ElevenLabs' multipart model request. */
export function selectElevenLabsAudioFileNameModelInput(params: {
  audioFile?: unknown
}): Record<string, unknown> {
  if (!params.audioFile) return {}
  return { audioFile: selectModelVisibleFileNames(params.audioFile) }
}

/** Restores the audio file with only its projected filename changed. */
export function applyProjectedElevenLabsAudioFileNameModelInput(
  original: { audioFile?: unknown },
  projected: Record<string, unknown>
): Record<string, unknown> {
  if (!Object.hasOwn(projected, 'audioFile')) return {}
  return {
    audioFile: applyProjectedModelVisibleFileNames(original.audioFile, projected.audioFile),
  }
}
