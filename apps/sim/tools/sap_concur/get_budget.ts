import type { GetBudgetParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getBudgetTool: ToolConfig<GetBudgetParams, SapConcurProxyResponse> = {
  id: 'sap_concur_get_budget',
  name: 'SAP Concur Get Budget',
  description: 'Get a budget item header by ID (GET /budget/v4/budgetItemHeader/{id}).',
  version: '1.0.0',
  params: {
    datacenter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Concur datacenter base URL (defaults to us.api.concursolutions.com)',
    },
    grantType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OAuth grant type: client_credentials (default) or password',
    },
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client secret',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Username (only for password grant)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password (only for password grant)',
    },
    companyUuid: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Company UUID for multi-company access tokens',
    },
    budgetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Budget item header ID (syncguid)',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const budgetId = trimRequired(params.budgetId, 'budgetId')
      return {
        ...baseProxyBody(params),
        path: `/budget/v4/budgetItemHeader/${encodeURIComponent(budgetId)}`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Budget header detail payload',
      properties: {
        id: { type: 'string', description: 'Budget item header ID' },
        name: { type: 'string', description: 'Admin-facing budget name' },
        description: { type: 'string', description: 'User-friendly display name' },
        budgetItemStatusType: {
          type: 'string',
          description: 'Status: OPEN, CLOSED, or REMOVED',
        },
        budgetType: {
          type: 'string',
          optional: true,
          description: 'Type: PERSONAL_USE, BUDGET, RESTRICTED, or TEAM',
        },
        periodType: {
          type: 'string',
          optional: true,
          description: 'Period type: YEARLY, QUARTERLY, MONTHLY, or DATE_RANGE',
        },
        currencyCode: { type: 'string', optional: true, description: 'ISO 4217 currency code' },
        isTest: { type: 'boolean', optional: true, description: 'Test budget flag' },
        active: { type: 'boolean', optional: true, description: 'Display availability flag' },
        owned: { type: 'boolean', optional: true, description: 'Caller ownership flag' },
        annualBudget: { type: 'number', optional: true, description: 'Total annual budget amount' },
        createdDate: { type: 'string', optional: true, description: 'UTC creation timestamp' },
        lastModifiedDate: {
          type: 'string',
          optional: true,
          description: 'UTC modification timestamp',
        },
        fiscalYear: {
          type: 'json',
          optional: true,
          description: 'Fiscal year reference (id, name, startDate, endDate, status)',
        },
        budgetAmounts: {
          type: 'json',
          optional: true,
          description:
            'Aggregate spend amounts (pendingAmount, spendAmount, unExpensedAmount, availableAmount, adjustedBudgetAmount, consumedPercent, threshold)',
        },
        owner: {
          type: 'json',
          optional: true,
          description: 'Owner user (externalUserCUUID, employeeUuid, email, employeeId, name)',
        },
        budgetManagers: {
          type: 'array',
          optional: true,
          description: 'Manager user objects',
          items: { type: 'json' },
        },
        budgetApprovers: {
          type: 'array',
          optional: true,
          description: 'Approver user objects',
          items: { type: 'json' },
        },
        budgetViewers: {
          type: 'array',
          optional: true,
          description: 'Viewer user objects',
          items: { type: 'json' },
        },
        budgetTeamMembers: {
          type: 'array',
          optional: true,
          description: 'Team member entries (budgetPerson, startDate, endDate, active, status)',
          items: { type: 'json' },
        },
        budgetCategory: {
          type: 'json',
          optional: true,
          description: 'Linked category (id, name, description, statusType)',
        },
        costObjects: {
          type: 'array',
          optional: true,
          description: 'Tracking field values (fieldDefinitionId, code, value, operator)',
          items: { type: 'json' },
        },
        budgetItemDetails: {
          type: 'array',
          optional: true,
          description:
            'Per-period detail entries (id, currencyCode, amount, budgetItemDetailStatusType, fiscalPeriod, budgetAmounts)',
          items: { type: 'json' },
        },
        dateRange: {
          type: 'json',
          optional: true,
          description: 'Date range for DATE_RANGE budgets (startDate, endDate)',
        },
      },
    },
  },
}
