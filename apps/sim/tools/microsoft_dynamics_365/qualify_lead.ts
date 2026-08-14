import { createLogger } from '@sim/logger'
import type {
  DataverseQualifyLeadParams,
  DataverseQualifyLeadResponse,
} from '@/tools/microsoft_dynamics_365/types'
import {
  getDataverseErrorMessage,
  getDynamics365BaseUrl,
  isDataverseObject,
  normalizeDataverseGuid,
  parseDataverseBoolean,
  parseDataverseInt32,
} from '@/tools/microsoft_dynamics_365/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseQualifyLead')

export const microsoftDynamics365QualifyLeadTool: ToolConfig<
  DataverseQualifyLeadParams,
  DataverseQualifyLeadResponse
> = {
  id: 'microsoft_dynamics_365_qualify_lead',
  name: 'Qualify Microsoft Dynamics 365 Lead',
  description:
    'Qualify a Dynamics 365 Sales lead and optionally create linked account, contact, and opportunity records.',
  version: '1.0.0',

  oauth: { required: true, provider: 'microsoft-dataverse' },
  errorExtractor: 'nested-error-object',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Microsoft Dataverse API',
    },
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Trusted Dynamics 365 environment bound to the selected OAuth credential',
    },
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dynamics 365 environment URL (e.g., https://myorg.crm.dynamics.com)',
    },
    leadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GUID of the lead to qualify',
    },
    createAccount: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to create an account from the lead',
    },
    createContact: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to create a contact from the lead',
    },
    createOpportunity: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to create an opportunity from the lead',
    },
    statusReason: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Qualified lead status-reason value (default: 3)',
    },
    opportunityCurrencyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional transaction currency GUID for the created opportunity',
    },
    opportunityCustomerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional account or contact GUID for the created opportunity customer',
    },
    opportunityCustomerType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer table type for opportunityCustomerId: account or contact',
    },
    sourceCampaignId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional source campaign GUID for the created opportunity',
    },
    processInstanceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional business process flow instance GUID for the created opportunity',
    },
    processInstanceEntityType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Logical table name for the business process flow instance',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getDynamics365BaseUrl(params.environmentUrl, params.instanceUrl)
      const leadId = normalizeDataverseGuid(params.leadId, 'leadId')
      return `${baseUrl}/api/data/v9.2/leads(${leadId})/Microsoft.Dynamics.CRM.QualifyLead`
    },
    method: 'POST',
    stripAuthOnRedirect: true,
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
    }),
    body: (params) => {
      const createAccount = parseDataverseBoolean(params.createAccount, 'createAccount')
      const createContact = parseDataverseBoolean(params.createContact, 'createContact')
      const createOpportunity = parseDataverseBoolean(params.createOpportunity, 'createOpportunity')
      const status =
        params.statusReason === undefined
          ? 3
          : parseDataverseInt32(params.statusReason, 'statusReason')
      const opportunityOnlyFields = [
        params.opportunityCurrencyId,
        params.opportunityCustomerId,
        params.opportunityCustomerType,
        params.sourceCampaignId,
        params.processInstanceId,
        params.processInstanceEntityType,
      ]
      if (!createOpportunity && opportunityOnlyFields.some((value) => value !== undefined)) {
        throw new Error('Opportunity details can only be provided when createOpportunity is true')
      }

      const hasCustomerId = params.opportunityCustomerId !== undefined
      const hasCustomerType = params.opportunityCustomerType !== undefined
      if (hasCustomerId !== hasCustomerType) {
        throw new Error(
          'opportunityCustomerId and opportunityCustomerType must be provided together'
        )
      }

      const body: Record<string, unknown> = {
        CreateAccount: createAccount,
        CreateContact: createContact,
        CreateOpportunity: createOpportunity,
        Status: status,
      }

      if (params.opportunityCurrencyId !== undefined) {
        body.OpportunityCurrencyId = {
          '@odata.type': 'Microsoft.Dynamics.CRM.transactioncurrency',
          transactioncurrencyid: normalizeDataverseGuid(
            params.opportunityCurrencyId,
            'opportunityCurrencyId'
          ),
        }
      }

      if (hasCustomerId && hasCustomerType) {
        const customerType = params.opportunityCustomerType
        if (customerType !== 'account' && customerType !== 'contact') {
          throw new Error('opportunityCustomerType must be account or contact')
        }
        const customerId = normalizeDataverseGuid(
          params.opportunityCustomerId as string,
          'opportunityCustomerId'
        )
        body.OpportunityCustomerId = {
          '@odata.type': `Microsoft.Dynamics.CRM.${customerType}`,
          [`${customerType}id`]: customerId,
        }
      }

      if (params.sourceCampaignId !== undefined) {
        body.SourceCampaignId = {
          '@odata.type': 'Microsoft.Dynamics.CRM.campaign',
          campaignid: normalizeDataverseGuid(params.sourceCampaignId, 'sourceCampaignId'),
        }
      }

      const hasProcessInstanceId = params.processInstanceId !== undefined
      const hasProcessInstanceEntityType = params.processInstanceEntityType !== undefined
      if (hasProcessInstanceId !== hasProcessInstanceEntityType) {
        throw new Error('processInstanceId and processInstanceEntityType must be provided together')
      }
      if (hasProcessInstanceId && hasProcessInstanceEntityType) {
        const entityType = params.processInstanceEntityType as string
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(entityType)) {
          throw new Error('processInstanceEntityType must be a valid Dataverse logical table name')
        }
        body.ProcessInstanceId = {
          '@odata.type': `Microsoft.Dynamics.CRM.${entityType}`,
          businessprocessflowinstanceid: normalizeDataverseGuid(
            params.processInstanceId as string,
            'processInstanceId'
          ),
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorMessage = await getDataverseErrorMessage(response)
      logger.error('Dataverse qualify lead failed', { status: response.status })
      throw new Error(errorMessage)
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new Error('Invalid Dataverse QualifyLead response: expected a JSON object')
    }
    if (!isDataverseObject(data) || !Array.isArray(data.value)) {
      throw new Error('Invalid Dataverse QualifyLead response: value must be an array')
    }
    if (!data.value.every(isDataverseObject)) {
      throw new Error('Invalid Dataverse QualifyLead response: every value item must be an object')
    }

    return {
      success: true,
      output: {
        createdEntities: data.value,
        success: true,
      },
    }
  },

  outputs: {
    createdEntities: {
      type: 'array',
      description:
        'Entity references returned by Dataverse for records created while qualifying the lead',
      items: {
        type: 'json',
        description:
          'A provider-defined account, contact, or opportunity entity reference returned by Dataverse',
      },
    },
    success: { type: 'boolean', description: 'Whether the lead was qualified successfully' },
  },
}
