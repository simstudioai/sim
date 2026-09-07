import {
  OCI_MUTATION_OUTPUTS,
  type OciEventsDeleteRuleParams,
  type OciEventsResponse,
} from '@/tools/oci_events/types'
import { OCI_CONNECTION_PARAMS, transformOciEventsResponse } from '@/tools/oci_events/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociEventsDeleteRuleTool: InternalToolConfig<
  OciEventsDeleteRuleParams,
  OciEventsResponse
> = {
  id: 'oci_events_delete_rule',
  name: 'OCI Events Delete Rule',
  description: 'Delete an OCI Events rule, optionally matching an ETag',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    ruleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Rule OCID, from List Rules or a previous rule response.',
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
      ifMatch: params.ifMatch,
    }),
  },
  transformResponse: transformOciEventsResponse,
  outputs: OCI_MUTATION_OUTPUTS,
}
