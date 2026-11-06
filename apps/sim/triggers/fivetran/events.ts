import { createFivetranTrigger } from '@/triggers/fivetran/utils'
import type { TriggerConfig } from '@/triggers/types'

/** Primary Fivetran trigger: carries the trigger-type dropdown for every Fivetran event. */
export const fivetranSyncEndTrigger: TriggerConfig = createFivetranTrigger('fivetran_sync_end', {
  includeDropdown: true,
})

export const fivetranSyncStartTrigger: TriggerConfig = createFivetranTrigger('fivetran_sync_start')

export const fivetranConnectionFailureTrigger: TriggerConfig = createFivetranTrigger(
  'fivetran_connection_failure'
)

export const fivetranConnectionSuccessfulTrigger: TriggerConfig = createFivetranTrigger(
  'fivetran_connection_successful'
)

export const fivetranCreateConnectorTrigger: TriggerConfig = createFivetranTrigger(
  'fivetran_create_connector'
)

export const fivetranEditConnectorTrigger: TriggerConfig =
  createFivetranTrigger('fivetran_edit_connector')

export const fivetranPauseConnectorTrigger: TriggerConfig = createFivetranTrigger(
  'fivetran_pause_connector'
)

export const fivetranResumeConnectorTrigger: TriggerConfig = createFivetranTrigger(
  'fivetran_resume_connector'
)

export const fivetranDeleteConnectorTrigger: TriggerConfig = createFivetranTrigger(
  'fivetran_delete_connector'
)

export const fivetranForceUpdateConnectorTrigger: TriggerConfig = createFivetranTrigger(
  'fivetran_force_update_connector'
)

export const fivetranResyncConnectorTrigger: TriggerConfig = createFivetranTrigger(
  'fivetran_resync_connector'
)

export const fivetranResyncTableTrigger: TriggerConfig =
  createFivetranTrigger('fivetran_resync_table')

export const fivetranTransformationStartTrigger: TriggerConfig = createFivetranTrigger(
  'fivetran_transformation_start'
)

export const fivetranTransformationSucceededTrigger: TriggerConfig = createFivetranTrigger(
  'fivetran_transformation_succeeded'
)

export const fivetranTransformationFailedTrigger: TriggerConfig = createFivetranTrigger(
  'fivetran_transformation_failed'
)
