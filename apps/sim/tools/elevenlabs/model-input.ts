import { selectModelBoundFileInputPaths } from '@/lib/uploads/utils/model-input'
import type { ResolvedSecretInputPath } from '@/executor/utils/resolved-secret-trace-registry'

/** Selects exact resolver paths for audio content consumed by ElevenLabs transforms. */
export function selectElevenLabsAudioModelInputPaths(params: {
  audioFile?: unknown
}): readonly ResolvedSecretInputPath[] {
  return selectModelBoundFileInputPaths(params.audioFile, ['audioFile'], {
    includeName: true,
  })
}
