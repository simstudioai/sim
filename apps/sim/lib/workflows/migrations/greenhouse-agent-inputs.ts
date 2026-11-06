import { isPlainRecord, omit } from '@sim/utils/object'
import { getBlock } from '@/blocks'
import type { BlockState } from '@/stores/workflows/workflow/types'

const GREENHOUSE_RETIRED_INPUTS: Record<string, Record<string, string>> = {
  list_application_stages: { created_at: 'created_at_filter' },
  list_applications: { created_at: 'created_at_filter', status: 'applications_status' },
  list_applied_candidate_tags: { created_at: 'created_at_filter' },
  list_attachments: { created_at: 'created_at_filter', type: 'attachments_type' },
  list_candidate_educations: { created_at: 'created_at_filter' },
  list_candidate_employments: { created_at: 'created_at_filter' },
  list_candidate_tags: { created_at: 'created_at_filter' },
  list_candidates: { created_at: 'created_at_filter' },
  list_close_reasons: { created_at: 'created_at_filter' },
  list_custom_field_options: { created_at: 'created_at_filter' },
  list_custom_fields: { created_at: 'created_at_filter' },
  list_departments: { created_at: 'created_at_filter' },
  list_email_templates: { created_at: 'created_at_filter' },
  list_interviews: { created_at: 'created_at_filter', status: 'interviews_status' },
  list_job_hiring_managers: { created_at: 'created_at_filter' },
  list_job_interview_stages: { created_at: 'created_at_filter' },
  list_job_owners: { created_at: 'created_at_filter', type: 'job_owners_type' },
  list_jobs: { created_at: 'created_at_filter', status: 'jobs_status' },
  list_notes: { created_at: 'created_at_filter', visibility: 'notes_visibility' },
  list_offers: { created_at: 'created_at_filter', status: 'offers_status' },
  list_offices: { created_at: 'created_at_filter' },
  list_openings: { created_at: 'created_at_filter' },
  list_prospect_pool_stages: { created_at: 'created_at_filter' },
  list_prospect_pools: { created_at: 'created_at_filter' },
  list_referrers: { created_at: 'created_at_filter' },
  list_rejection_reasons: { created_at: 'created_at_filter' },
  list_scorecards: { created_at: 'created_at_filter', status: 'scorecards_status' },
  list_sources: { created_at: 'created_at_filter' },
  list_users: { created_at: 'created_at_filter' },
  create_attachment: { type: 'attachments_type', visibility: 'attachment_visibility' },
  update_application: { id: 'update_application_id', created_at: 'application_created_on' },
  update_candidate: { id: 'update_application_id' },
  convert_prospect: { id: 'update_application_id', job_id: 'convert_prospect_job_id' },
  hire_application: { id: 'update_application_id', opening_id: 'hire_application_opening_id' },
  move_application: { id: 'update_application_id' },
  reject_application: { id: 'update_application_id' },
  unreject_application: { id: 'update_application_id' },
  create_application: { job_ids: 'create_application_job_ids' },
  create_note: { visibility: 'attachment_visibility' },
}

/** Operation-scoped renames shared by the workflow migration registry and normalizer. */
export const GREENHOUSE_SUBBLOCK_ID_MIGRATIONS = Object.entries(GREENHOUSE_RETIRED_INPUTS).flatMap(
  ([operation, fields]) =>
    Object.entries(fields).map(([to, from]) => ({ from, to, whenOperation: [operation] }))
)

const RETIRED_IDS = [...new Set(GREENHOUSE_SUBBLOCK_ID_MIGRATIONS.map(({ from }) => from))]

/**
 * Moves the active Harvest v3 UI aliases onto their tool parameter IDs. Canonical targets
 * may already hold values from unrelated operations, so the old operation's alias wins,
 * including an intentional blank. Retired aliases are all removed so changing operations
 * later cannot restore a stale alias over a newly configured canonical value. Incomplete
 * imports retain their fields until a recognized operation determines which values apply.
 */
export function migrateGreenhouseAgentInputs(block: BlockState): BlockState {
  if (block.type !== 'greenhouse_v2') return block
  const config = getBlock(block.type)
  const storedOperation: unknown = block.subBlocks.operation
  const operation = isPlainRecord(storedOperation) ? storedOperation.value : storedOperation
  const operations = config?.subBlocks.find((field) => field.id === 'operation')?.options
  if (
    typeof operation !== 'string' ||
    !Array.isArray(operations) ||
    !operations.some((option) => option.id === operation)
  )
    return block
  const aliases = GREENHOUSE_RETIRED_INPUTS[operation] ?? {}
  let subBlocks = block.subBlocks
  for (const [target, source] of Object.entries(aliases)) {
    if (!Object.hasOwn(subBlocks, source)) continue
    const saved: unknown = subBlocks[source]
    const targetConfig = config?.subBlocks.find((field) => field.id === target)
    if (!targetConfig) continue
    subBlocks = omit(subBlocks, [source])
    if (isPlainRecord(saved)) {
      subBlocks[target] = {
        ...saved,
        id: target,
        type: targetConfig.type,
        value: (Object.hasOwn(saved, 'value')
          ? saved.value
          : null) as BlockState['subBlocks'][string]['value'],
      }
    } else {
      subBlocks[target] = {
        id: target,
        type: targetConfig.type,
        value: saved as BlockState['subBlocks'][string]['value'],
      }
    }
  }
  if (RETIRED_IDS.some((id) => id in subBlocks)) subBlocks = omit(subBlocks, RETIRED_IDS)
  return subBlocks === block.subBlocks ? block : { ...block, subBlocks }
}
