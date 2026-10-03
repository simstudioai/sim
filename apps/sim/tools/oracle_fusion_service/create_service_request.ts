import {
  oracleFusionServiceAuthParams,
  oracleFusionServiceOAuth,
  oracleFusionServiceRequestOutputs,
} from '@/tools/oracle_fusion_service/shared'
import type {
  OracleFusionServiceParams,
  OracleFusionServiceResponse,
} from '@/tools/oracle_fusion_service/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionServiceCreateServiceRequestTool: InternalToolConfig<
  OracleFusionServiceParams,
  OracleFusionServiceResponse
> = {
  id: 'oracle_fusion_service_create_service_request',
  name: 'Oracle Fusion Service Create Service Request',
  description:
    'Create a Fusion Service request with a title and service business unit. Customer and routing references use exact decimal IDs.',
  version: '1.0.0',
  oauth: oracleFusionServiceOAuth,
  params: {
    ...oracleFusionServiceAuthParams,
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Service request title, up to 400 characters.',
    },
    businessUnitId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Service business unit BUOrgId as an exact decimal string.',
    },
    problemDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Problem description, up to 1000 characters.',
    },
    accountPartyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer account PartyId as an exact decimal string.',
    },
    contactPartyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contact PartyId as an exact decimal string.',
    },
    severityCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tenant severity code from ORA_SVC_SR_SEVERITY_CD.',
    },
    channelTypeCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tenant channel code from ORA_SVC_CHANNEL_TYPE_CD.',
    },
    statusCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tenant service request status LookupCode. Oracle enforces valid transitions.',
    },
    queueId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QueueId as an exact decimal string.',
    },
    resourcePartyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Agent resource PartyId, not ResourceProfileId. Sent as AssigneeResourceId or child ObjectId.',
    },
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      instanceUrl: params.instanceUrl,
      title: params.title,
      businessUnitId: params.businessUnitId,
      problemDescription: params.problemDescription,
      accountPartyId: params.accountPartyId,
      contactPartyId: params.contactPartyId,
      severityCode: params.severityCode,
      channelTypeCode: params.channelTypeCode,
      statusCode: params.statusCode,
      queueId: params.queueId,
      resourcePartyId: params.resourcePartyId,
    }),
  },
  outputs: {
    item: {
      type: 'object',
      description: 'Documented Oracle resource fields.',
      properties: oracleFusionServiceRequestOutputs,
    },
  },
}
