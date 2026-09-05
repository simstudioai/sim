import {
  oracleFusionServiceAuthParams,
  oracleFusionServiceOAuth,
  oracleFusionServiceRequestContactsOutputs,
} from '@/tools/oracle_fusion_service/shared'
import type {
  OracleFusionServiceParams,
  OracleFusionServiceResponse,
} from '@/tools/oracle_fusion_service/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionServiceAddServiceRequestContactTool: InternalToolConfig<
  OracleFusionServiceParams,
  OracleFusionServiceResponse
> = {
  id: 'oracle_fusion_service_add_service_request_contact',
  name: 'Oracle Fusion Service Add Service Request Contact',
  description:
    'Add an existing contact as a service request member. This does not create or modify the customer-master contact.',
  version: '1.0.0',
  oauth: oracleFusionServiceOAuth,
  params: {
    ...oracleFusionServiceAuthParams,
    srNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Service request number (SrNumber), not the numeric SrId.',
    },
    contactPartyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Contact PartyId as an exact decimal string.',
    },
    accessLevelCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Service request contact access-level code.',
    },
    relationTypeCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Service request contact relationship code.',
    },
    primaryContact: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether this member is the primary service request contact.',
    },
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      instanceUrl: params.instanceUrl,
      srNumber: params.srNumber,
      contactPartyId: params.contactPartyId,
      accessLevelCode: params.accessLevelCode,
      relationTypeCode: params.relationTypeCode,
      primaryContact: params.primaryContact,
    }),
  },
  outputs: {
    item: {
      type: 'object',
      description: 'Documented Oracle resource fields.',
      properties: oracleFusionServiceRequestContactsOutputs,
    },
  },
}
