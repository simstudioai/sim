import {
  applyProjectedModelVisibleFileNames,
  selectModelVisibleFileNames,
} from '@/lib/uploads/utils/model-input'

interface SttAudioModelInputParams {
  audioFile?: unknown
  audioFileReference?: unknown
}

/** Selects the filename for the single audio source whose name is sent to a model provider. */
export function selectSttAudioFileNameModelInput(
  params: SttAudioModelInputParams
): Record<string, unknown> {
  if (params.audioFile) {
    return { audioFile: selectModelVisibleFileNames(params.audioFile) }
  }
  if (params.audioFileReference) {
    return { audioFileReference: selectModelVisibleFileNames(params.audioFileReference) }
  }
  return {}
}

/** Restores the selected audio source with only its projected filename changed. */
export function applyProjectedSttAudioFileNameModelInput(
  original: SttAudioModelInputParams,
  projected: Record<string, unknown>
): Record<string, unknown> {
  const hasAudioFile = Object.hasOwn(projected, 'audioFile')
  const hasAudioFileReference = Object.hasOwn(projected, 'audioFileReference')
  if (hasAudioFile && hasAudioFileReference) {
    throw new Error('Projected STT input contains multiple audio sources')
  }
  if (hasAudioFile) {
    return {
      audioFile: applyProjectedModelVisibleFileNames(original.audioFile, projected.audioFile),
    }
  }
  if (hasAudioFileReference) {
    return {
      audioFileReference: applyProjectedModelVisibleFileNames(
        original.audioFileReference,
        projected.audioFileReference
      ),
    }
  }
  return {}
}
