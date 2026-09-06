import {
  OCI_MUTATION_OUTPUTS,
  type OciEventsChangeRuleCompartmentParams,
  type OciEventsResponse,
} from '@/tools/oci_events/types'
import { OCI_CONNECTION_PARAMS, transformOciEventsResponse } from '@/tools/oci_events/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociEventsChangeRuleCompartmentTool: InternalToolConfig<
  OciEventsChangeRuleCompartmentParams,
  OciEventsResponse
> = {
  id: 'oci_events_change_rule_compartment',
  name: 'OCI Events Change Rule Compartment',
  description: 'Move an OCI Events rule to another compartment in the same tenancy',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    ruleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Rule OCID, from List Rules or a previous rule response.',
    },
    destinationCompartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Destination compartment OCID in the same tenancy; moving changes event matching scope.',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ETag from Get Rule; mutation fails if the rule changed since that read.',
    },
    opcRetryToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional stable retry token, 1–64 characters. Reuse for retries of the same create or move request.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      opcRequestId: params.opcRequestId,
      ruleId: params.ruleId,
      destinationCompartmentId: params.destinationCompartmentId,
      ifMatch: params.ifMatch,
      opcRetryToken: params.opcRetryToken,
    }),
  },
  transformResponse: transformOciEventsResponse,
  outputs: OCI_MUTATION_OUTPUTS,
}
