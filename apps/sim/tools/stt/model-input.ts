import { selectModelBoundFileInput } from '@/lib/uploads/utils/model-input'

interface SttAudioModelInputParams {
  audioFile?: unknown
  audioFileReference?: unknown
  audioUrl?: unknown
}

/** Selects the single audio source consumed by the shared STT route. */
export function selectSttAudioModelInput(
  params: SttAudioModelInputParams,
  options: { includeName?: boolean } = {}
): unknown {
  const fileOptions = { includeName: options.includeName ?? false } as const

  if (params.audioFile) {
    return selectModelBoundFileInput(params.audioFile, fileOptions)
  }
  if (params.audioFileReference) {
    return selectModelBoundFileInput(params.audioFileReference, fileOptions)
  }
  if (typeof params.audioUrl === 'string' && params.audioUrl.trim() !== '') {
    return params.audioUrl.trim()
  }
  return undefined
}
