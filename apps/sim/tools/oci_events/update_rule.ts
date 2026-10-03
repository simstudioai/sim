import {
  OCI_RULE_OUTPUTS,
  type OciEventsResponse,
  type OciEventsUpdateRuleParams,
} from '@/tools/oci_events/types'
import { OCI_CONNECTION_PARAMS, transformOciEventsResponse } from '@/tools/oci_events/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociEventsUpdateRuleTool: InternalToolConfig<
  OciEventsUpdateRuleParams,
  OciEventsResponse
> = {
  id: 'oci_events_update_rule',
  name: 'OCI Events Update Rule',
  description: 'Update rule settings and replace supplied conditions, actions or tags',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    ruleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Rule OCID, from List Rules or a previous rule response.',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rule display name; list operations apply the OCI displayName filter.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Rule description, up to 1024 characters. An explicit empty string clears it on update.',
    },
    isEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the rule is enabled. Omit on update to keep the current state.',
    },
    condition: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON filter object, for example {"eventType":"com.oraclecloud.objectstorage.createbucket"}. Explicit {} matches all compartment and child-compartment events. Replaces the condition on update.',
    },
    actions: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of 1–10 actions. Each requires actionType, isEnabled and topicId (ONS), streamId (OSS) or functionId (FAAS); description is optional. Replaces all actions on update. No action IDs or lifecycle fields.',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Map of tag names to string values. Replaces all freeform tags on update; {} clears them.',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Map of tag namespaces to tag-name/string-value maps. Replaces defined tags on update; {} clears them.',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ETag from Get Rule; mutation fails if the rule changed since that read.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      opcRequestId: params.opcRequestId,
      ruleId: params.ruleId,
      displayName: params.displayName,
      description: params.description,
      isEnabled: params.isEnabled,
      condition: params.condition,
      actions: params.actions,
      freeformTags: params.freeformTags,
      definedTags: params.definedTags,
      ifMatch: params.ifMatch,
    }),
  },
  transformResponse: transformOciEventsResponse,
  outputs: OCI_RULE_OUTPUTS,
}
