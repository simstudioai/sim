import { selectModelBoundFileInputPaths } from '@/lib/uploads/utils/model-input'
import type { ResolvedSecretInputPath } from '@/executor/utils/resolved-secret-trace-registry'

interface SttAudioModelInputParams {
  audioFile?: unknown
  audioFileReference?: unknown
  audioUrl?: unknown
}

/** Selects exact resolver paths for the single audio source consumed by the shared STT route. */
export function selectSttAudioModelInputPaths(
  params: SttAudioModelInputParams,
  options: { includeName?: boolean } = {}
): readonly ResolvedSecretInputPath[] {
  const fileOptions = { includeName: options.includeName ?? false } as const

  if (params.audioFile) {
    return selectModelBoundFileInputPaths(params.audioFile, ['audioFile'], fileOptions)
  }
  if (params.audioFileReference) {
    return selectModelBoundFileInputPaths(
      params.audioFileReference,
      ['audioFileReference'],
      fileOptions
    )
  }
  if (typeof params.audioUrl === 'string' && params.audioUrl.trim() !== '') {
    return [['audioUrl']]
  }
  return []
}
