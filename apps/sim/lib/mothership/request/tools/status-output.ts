import { isRecordLike } from '@sim/utils/object'
import { ArtifactObservations } from '@/lib/mothership/generated/observations'

/** Visual bytes reach the model through durable tool results, not the bounded UI replay stream. */
export function toolStatusOutput(output: unknown): unknown {
  if (!isRecordLike(output) || !('observations' in output)) return output
  const observations = ArtifactObservations.safeParse(output.observations)
  return {
    ...output,
    observations: observations.success
      ? observations.data.map(({ data: _data, ...metadata }) => metadata)
      : [],
  }
}
