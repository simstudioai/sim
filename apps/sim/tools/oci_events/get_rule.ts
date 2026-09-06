import {
  OCI_RULE_OUTPUTS,
  type OciEventsGetRuleParams,
  type OciEventsResponse,
} from '@/tools/oci_events/types'
import { OCI_CONNECTION_PARAMS, transformOciEventsResponse } from '@/tools/oci_events/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociEventsGetRuleTool: InternalToolConfig<OciEventsGetRuleParams, OciEventsResponse> = {
  id: 'oci_events_get_rule',
  name: 'OCI Events Get Rule',
  description: 'Get an OCI Events rule with its actions and ETag',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    ruleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Rule OCID, from List Rules or a previous rule response.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      opcRequestId: params.opcRequestId,
      ruleId: params.ruleId,
    }),
  },
  transformResponse: transformOciEventsResponse,
  outputs: OCI_RULE_OUTPUTS,
}
