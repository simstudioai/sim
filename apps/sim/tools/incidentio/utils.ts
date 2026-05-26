import type { Workflow } from '@/tools/incidentio/types'

function getJsonParseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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

function toArrayValue<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function parseIncidentioJsonParam(
  jsonString: string | undefined,
  paramName: string,
  defaultValue: unknown
): unknown {
  if (jsonString === undefined || jsonString === '') return defaultValue

  try {
    return JSON.parse(jsonString)
  } catch (error) {
    throw new Error(`Invalid JSON for ${paramName}: ${getJsonParseErrorMessage(error)}`)
  }
}

export function parseRequiredIncidentioJsonParam(
  jsonString: string | undefined,
  paramName: string
): unknown {
  if (jsonString === undefined || jsonString === '') {
    throw new Error(`Missing required JSON for ${paramName}`)
  }

  return parseIncidentioJsonParam(jsonString, paramName, undefined)
}

export function mapIncidentioWorkflow(workflow: Record<string, unknown>): Workflow {
  return {
    id: toStringValue(workflow.id),
    name: toStringValue(workflow.name),
    trigger: toStringValue(workflow.trigger),
    once_for: toArrayValue(workflow.once_for),
    version: toNumberValue(workflow.version),
    expressions: toArrayValue(workflow.expressions),
    condition_groups: toArrayValue(workflow.condition_groups),
    steps: toArrayValue(workflow.steps),
    include_private_incidents: toBooleanValue(workflow.include_private_incidents),
    include_private_escalations: toBooleanValue(workflow.include_private_escalations),
    runs_on_incident_modes: toArrayValue<string>(workflow.runs_on_incident_modes),
    continue_on_step_error: toBooleanValue(workflow.continue_on_step_error),
    runs_on_incidents: toStringValue(workflow.runs_on_incidents) as Workflow['runs_on_incidents'],
    state: toStringValue(workflow.state) as Workflow['state'],
    delay: workflow.delay,
    folder: toOptionalStringValue(workflow.folder),
    runs_from: toOptionalStringValue(workflow.runs_from),
    shortform: toOptionalStringValue(workflow.shortform),
  }
}
