import { selectModelBoundFileInput } from '@/lib/uploads/utils/model-input'

/** Selects the audio source consumed by ElevenLabs speech transforms. */
export function selectElevenLabsAudioModelInput(params: { audioFile?: unknown }): unknown {
  return selectModelBoundFileInput(params.audioFile, {
    includeName: true,
  })
}
