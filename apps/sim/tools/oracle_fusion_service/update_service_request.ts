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

export const oracleFusionServiceUpdateServiceRequestTool: InternalToolConfig<
  OracleFusionServiceParams,
  OracleFusionServiceResponse
> = {
  id: 'oracle_fusion_service_update_service_request',
  name: 'Oracle Fusion Service Update Service Request',
  description:
    'Update a Fusion Service request description, customer references, severity, or channel. Use the dedicated tools for status transitions and assignment.',
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
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Service request title, up to 400 characters.',
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
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional Oracle ETag for conditional PATCH or DELETE (If-Match).',
    },
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      instanceUrl: params.instanceUrl,
      srNumber: params.srNumber,
      title: params.title,
      problemDescription: params.problemDescription,
      accountPartyId: params.accountPartyId,
      contactPartyId: params.contactPartyId,
      severityCode: params.severityCode,
      channelTypeCode: params.channelTypeCode,
      ifMatch: params.ifMatch,
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
