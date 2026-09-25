import { isRecordLike } from '@sim/utils/object'
import { ArtifactObservations } from '@/lib/mothership/generated/observations'

/** Visual bytes reach the model through durable tool results, not the bounded UI replay stream. */
export function toolStatusOutput(output: unknown): unknown {
  if (!isRecordLike(output)) return output
  const observations = ArtifactObservations.safeParse(output.observations)
  if (!observations.success) return output
  return {
    ...output,
    observations: observations.data.map(({ data: _data, ...metadata }) => metadata),
  }
}
