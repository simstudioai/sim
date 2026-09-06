import type { OciEventsParams } from '@/lib/internal/oci-events/input'
import type { OciEventRule, OciEventRuleSummary } from '@/lib/internal/oci-events/operations'
import type { ToolResponse } from '@/tools/types'

export type OciEventsListRulesParams = OciEventsParams<'list_rules'>
export type OciEventsGetRuleParams = OciEventsParams<'get_rule'>
export type OciEventsCreateRuleParams = OciEventsParams<'create_rule'>
export type OciEventsUpdateRuleParams = OciEventsParams<'update_rule'>
export type OciEventsDeleteRuleParams = OciEventsParams<'delete_rule'>
export type OciEventsChangeRuleCompartmentParams = OciEventsParams<'change_rule_compartment'>

export interface OciEventsResponse extends ToolResponse {
  output: {
    status?: number
    opcRequestId?: string | null
    nextPage?: string | null
    etag?: string | null
    rules?: OciEventRuleSummary[]
    rule?: OciEventRule
  }
}

const RULE_SUMMARY_PROPERTIES = {
  id: { type: 'string', description: 'Rule OCID' },
  displayName: { type: 'string', description: 'Rule display name' },
  compartmentId: { type: 'string', description: 'Rule compartment OCID' },
  condition: { type: 'string', description: 'Event filter encoded as a JSON string' },
  isEnabled: { type: 'boolean', description: 'Whether the rule is enabled' },
  lifecycleState: { type: 'string', description: 'Current resource lifecycle state' },
  timeCreated: { type: 'string', description: 'Creation time (RFC3339)' },
  description: { type: 'string', description: 'Rule description', optional: true },
  freeformTags: { type: 'json', description: 'Tag names and string values', optional: true },
  definedTags: { type: 'json', description: 'Tag namespaces and values', optional: true },
} as const

const ACTION_PROPERTIES = {
  id: { type: 'string', description: 'Action OCID' },
  actionType: { type: 'string', description: 'ONS, OSS or FAAS' },
  lifecycleState: { type: 'string', description: 'Current action lifecycle state' },
  lifecycleMessage: { type: 'string', description: 'Action lifecycle message', optional: true },
  isEnabled: { type: 'boolean', description: 'Whether the action is enabled', optional: true },
  description: { type: 'string', description: 'Action description', optional: true },
  topicId: { type: 'string', description: 'ONS topic OCID', optional: true },
  streamId: { type: 'string', description: 'OSS stream OCID', optional: true },
  functionId: { type: 'string', description: 'FAAS function OCID', optional: true },
} as const

export const OCI_MUTATION_OUTPUTS = {
  status: { type: 'number', description: 'OCI HTTP response status' },
  opcRequestId: { type: 'string', description: 'OCI request identifier', optional: true },
} as const

export const OCI_RULES_OUTPUTS = {
  ...OCI_MUTATION_OUTPUTS,
  rules: {
    type: 'array',
    description: 'One page of rule summaries; actions require Get Rule',
    items: { type: 'object', properties: RULE_SUMMARY_PROPERTIES },
  },
  nextPage: { type: 'string', description: 'Opaque continuation token', optional: true },
} as const

export const OCI_RULE_OUTPUTS = {
  ...OCI_MUTATION_OUTPUTS,
  rule: {
    type: 'json',
    description: 'Rule configuration including its actions',
    properties: {
      ...RULE_SUMMARY_PROPERTIES,
      lifecycleMessage: { type: 'string', description: 'Rule lifecycle message', optional: true },
      actions: {
        type: 'json',
        description: 'Configured action list',
        properties: {
          actions: {
            type: 'array',
            description: 'Notifications, Streaming or Functions actions',
            items: { type: 'object', properties: ACTION_PROPERTIES },
          },
        },
      },
    },
  },
  etag: {
    type: 'string',
    description: 'ETag for conditional updates, moves or deletion',
    optional: true,
  },
} as const
