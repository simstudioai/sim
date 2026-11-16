import { getErrorMessage } from '@sim/utils/errors'
import { toArray, toRecord, toRecordOrNull } from '@sim/utils/object'
import type {
  IncidentioActionSummary,
  IncidentioFollowUpSummary,
  IncidentioLegacyCreator,
  Workflow,
} from '@/tools/incidentio/types'
import type { ToolResponse } from '@/tools/types'

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function toOptionalStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function toNumberValue(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}

function toBooleanValue(value: unknown): boolean {
  return value === true
}

/**
 * Splits a comma-separated list param into trimmed, non-empty entries. An array (as a model sends
 * for a list-shaped field) is accepted as is.
 */
export function parseIncidentioList(value: string | string[]): string[] {
  const entries = Array.isArray(value) ? value : String(value).split(',')
  return entries.map((entry) => String(entry).trim()).filter(Boolean)
}

/**
 * Parses a JSON-typed param. A value that is already structured (an array or object sent by a
 * model, or a resolved block-output reference) is returned as is; only strings are parsed.
 */
export function parseIncidentioJsonParam(
  value: unknown,
  paramName: string,
  defaultValue: unknown
): unknown {
  if (value === undefined || value === null || value === '') return defaultValue
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid JSON for ${paramName}: ${getErrorMessage(error)}`)
  }
}

export function parseRequiredIncidentioJsonParam(value: unknown, paramName: string): unknown {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required JSON for ${paramName}`)
  }

  return parseIncidentioJsonParam(value, paramName, undefined)
}

/**
 * Maps the API's actor envelope (`{ user | api_key | workflow | alert }`) onto the creator shape the
 * list/show tools have always declared: `id`/`name`/`email` come from whichever actor is set, and
 * the raw actor keys are passed through alongside them.
 */
function mapIncidentioCreator(value: unknown): IncidentioLegacyCreator | undefined {
  const creator = toRecordOrNull(value)
  if (!creator) return undefined
  const user = toRecordOrNull(creator.user)
  const apiKey = toRecordOrNull(creator.api_key)
  const workflow = toRecordOrNull(creator.workflow)
  const alert = toRecordOrNull(creator.alert)
  const source = user ?? apiKey ?? workflow ?? alert
  return {
    id: toOptionalStringValue(source?.id),
    name: toOptionalStringValue(source?.name) ?? toOptionalStringValue(alert?.title),
    email: toOptionalStringValue(user?.email),
    user: creator.user as IncidentioLegacyCreator['user'],
    api_key: creator.api_key as IncidentioLegacyCreator['api_key'],
    workflow: creator.workflow as IncidentioLegacyCreator['workflow'],
    alert: creator.alert as IncidentioLegacyCreator['alert'],
  }
}

function mapAssignee(value: unknown): IncidentioActionSummary['assignee'] {
  const assignee = toRecordOrNull(value)
  if (!assignee) return undefined
  return {
    id: toStringValue(assignee.id),
    name: toStringValue(assignee.name),
    email: toOptionalStringValue(assignee.email),
  }
}

function mapExternalIssueReference(
  value: unknown
): IncidentioFollowUpSummary['external_issue_reference'] {
  const reference = toRecordOrNull(value)
  if (!reference) return undefined
  return {
    provider: toStringValue(reference.provider),
    issue_name: toStringValue(reference.issue_name),
    issue_permalink: toStringValue(reference.issue_permalink),
  }
}

/** Maps an action as returned by `GET /v3/actions[/{id}]` onto the list/show output shape. */
export function mapIncidentioActionSummary(value: unknown): IncidentioActionSummary {
  const action = toRecord(value)
  return {
    id: toStringValue(action.id),
    description: toOptionalStringValue(action.description) ?? '',
    assignee: mapAssignee(action.assignee),
    status: toStringValue(action.status),
    created_at: toStringValue(action.created_at),
    updated_at: toStringValue(action.updated_at),
    incident_id: toOptionalStringValue(action.incident_id),
    creator: mapIncidentioCreator(action.creator),
    completed_at: toOptionalStringValue(action.completed_at),
  }
}

/** Maps a follow-up as returned by `GET /v3/follow_ups[/{id}]` onto the list/show output shape. */
export function mapIncidentioFollowUpSummary(value: unknown): IncidentioFollowUpSummary {
  const followUp = toRecord(value)
  const priority = toRecordOrNull(followUp.priority)
  const assigneeTeam = toRecordOrNull(followUp.assignee_team)
  const category = toRecordOrNull(followUp.category)
  return {
    id: toStringValue(followUp.id),
    title: toOptionalStringValue(followUp.title) ?? '',
    description: toOptionalStringValue(followUp.description),
    assignee: mapAssignee(followUp.assignee),
    assignee_team: assigneeTeam
      ? { id: toStringValue(assigneeTeam.id), name: toStringValue(assigneeTeam.name) }
      : undefined,
    status: toStringValue(followUp.status),
    priority: priority
      ? {
          id: toStringValue(priority.id),
          name: toStringValue(priority.name),
          description: toOptionalStringValue(priority.description),
          rank: toNumberValue(priority.rank),
        }
      : undefined,
    category: category
      ? {
          id: toStringValue(category.id),
          name: toStringValue(category.name),
          description: toOptionalStringValue(category.description),
          rank: toNumberValue(category.rank),
        }
      : undefined,
    created_at: toStringValue(followUp.created_at),
    updated_at: toStringValue(followUp.updated_at),
    incident_id: toOptionalStringValue(followUp.incident_id),
    creator: mapIncidentioCreator(followUp.creator),
    completed_at: toOptionalStringValue(followUp.completed_at),
    labels: toArray<string>(followUp.labels),
    external_issue_reference: mapExternalIssueReference(followUp.external_issue_reference),
  }
}

/** The API returns the trigger as `{ name, label }`; the output keeps the name string. */
function mapWorkflowTrigger(value: unknown): string {
  const trigger = toRecordOrNull(value)
  return trigger ? toStringValue(trigger.name) : toStringValue(value)
}

export function mapIncidentioWorkflow(workflow: Record<string, unknown>): Workflow {
  return {
    id: toStringValue(workflow.id),
    name: toStringValue(workflow.name),
    trigger: mapWorkflowTrigger(workflow.trigger),
    once_for: toArray(workflow.once_for),
    version: toNumberValue(workflow.version),
    expressions: toArray(workflow.expressions),
    condition_groups: toArray(workflow.condition_groups),
    steps: toArray(workflow.steps),
    include_private_incidents: toBooleanValue(workflow.include_private_incidents),
    include_private_escalations: toBooleanValue(workflow.include_private_escalations),
    runs_on_incident_modes: toArray<string>(workflow.runs_on_incident_modes),
    continue_on_step_error: toBooleanValue(workflow.continue_on_step_error),
    runs_on_incidents: toStringValue(workflow.runs_on_incidents) as Workflow['runs_on_incidents'],
    state: toStringValue(workflow.state) as Workflow['state'],
    delay: workflow.delay,
    folder: toOptionalStringValue(workflow.folder),
    runs_from: toOptionalStringValue(workflow.runs_from),
    shortform: toOptionalStringValue(workflow.shortform),
  }
}

/** Most pages a list tool follows on its own: 2,500 records at the v3 maximum page size. */
const INCIDENTIO_AUTO_PAGE_LIMIT = 10

type IncidentioCollectedPages<T> = { items: T[]; after?: string } | { error: string }

/**
 * Follows `pagination_meta.after` cursors from a first v3 list page until the list is exhausted or
 * {@link INCIDENTIO_AUTO_PAGE_LIMIT} pages are read. The v3 list endpoints return records oldest
 * first, so stopping at one page would drop the newest records the deprecated v2 endpoints returned.
 * Returns the collected items with the cursor left to resume from (unset when complete), or the
 * error of the first page that failed.
 */
export async function collectIncidentioPages<T>(
  first: { items: T[]; after?: string },
  itemsKey: string,
  fetchPage: (after: string) => Promise<ToolResponse>
): Promise<IncidentioCollectedPages<T>> {
  const items = [...first.items]
  let after = first.after
  for (let pages = 1; after && pages < INCIDENTIO_AUTO_PAGE_LIMIT; pages++) {
    const page = await fetchPage(after)
    if (!page.success) return { error: page.error || 'Failed to fetch the next page' }
    items.push(...toArray<T>(page.output[itemsKey]))
    after = toOptionalStringValue(toRecord(page.output.pagination_meta).after)
  }
  return { items, after }
}
