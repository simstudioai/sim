import type { GetExpenseReportParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getExpenseReportTool: ToolConfig<GetExpenseReportParams, SapConcurProxyResponse> = {
  id: 'sap_concur_get_expense_report',
  name: 'SAP Concur Get Expense Report',
  description:
    'Retrieve a single expense report header by id via Expense Report v4 (/expensereports/v4/users/{userId}/context/{contextType}/reports/{reportId}).',
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
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Concur user UUID who owns the report',
    },
    contextType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Access context: TRAVELER (own report), MANAGER (report under approval), PROCESSOR, or PROXY',
    },
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense report ID',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const userId = trimRequired(params.userId, 'userId')
      const contextType = trimRequired(params.contextType, 'contextType')
      const reportId = trimRequired(params.reportId, 'reportId')
      return {
        ...baseProxyBody(params),
        path: `/expensereports/v4/users/${encodeURIComponent(userId)}/context/${encodeURIComponent(contextType)}/reports/${encodeURIComponent(reportId)}`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Concur expense report header (ReportDetails)',
      properties: {
        reportId: { type: 'string', description: 'Unique report identifier' },
        reportNumber: { type: 'string', description: 'Report number', optional: true },
        reportFormId: { type: 'string', description: 'Report form ID' },
        policyId: { type: 'string', description: 'Policy ID applied to the report' },
        policy: { type: 'string', description: 'Policy name' },
        name: { type: 'string', description: 'Report name' },
        currencyCode: { type: 'string', description: 'ISO currency code' },
        currency: { type: 'string', description: 'Currency name', optional: true },
        approvalStatus: { type: 'string', description: 'Approval status name' },
        approvalStatusId: { type: 'string', description: 'Approval status identifier' },
        paymentStatus: { type: 'string', description: 'Payment status name' },
        paymentStatusId: { type: 'string', description: 'Payment status identifier' },
        ledger: { type: 'string', description: 'Ledger name', optional: true },
        ledgerId: { type: 'string', description: 'Ledger identifier', optional: true },
        userId: { type: 'string', description: 'Owner user UUID' },
        reportDate: { type: 'string', description: 'Report date (YYYY-MM-DD)' },
        creationDate: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
        submitDate: {
          type: 'string',
          description: 'Submit timestamp (ISO 8601) or null',
          optional: true,
        },
        startDate: {
          type: 'string',
          description: 'Report period start (YYYY-MM-DD)',
          optional: true,
        },
        endDate: { type: 'string', description: 'Report period end (YYYY-MM-DD)', optional: true },
        approvedAmount: {
          type: 'json',
          description: 'Amount approved { value, currencyCode }',
          optional: true,
        },
        claimedAmount: {
          type: 'json',
          description: 'Amount claimed { value, currencyCode }',
          optional: true,
        },
        reportTotal: {
          type: 'json',
          description: 'Report total { value, currencyCode }',
          optional: true,
        },
        amountDueEmployee: { type: 'json', description: 'Amount due employee', optional: true },
        amountDueCompany: { type: 'json', description: 'Amount due company', optional: true },
        amountDueCompanyCard: {
          type: 'json',
          description: 'Amount due company card',
          optional: true,
        },
        amountCompanyPaid: { type: 'json', description: 'Amount company has paid', optional: true },
        personalAmount: {
          type: 'json',
          description: 'Personal portion of the report',
          optional: true,
        },
        paymentConfirmedAmount: {
          type: 'json',
          description: 'Confirmed payment amount',
          optional: true,
        },
        amountNotApproved: { type: 'json', description: 'Amount not approved', optional: true },
        totalAmountPaidEmployee: {
          type: 'json',
          description: 'Total amount paid to employee',
          optional: true,
        },
        concurAuditStatus: { type: 'string', description: 'Concur audit status', optional: true },
        isFinancialIntegrationEnabled: {
          type: 'boolean',
          description: 'Whether financial integration is enabled',
          optional: true,
        },
        isSubmitted: {
          type: 'boolean',
          description: 'Whether the report has been submitted',
          optional: true,
        },
        isSentBack: {
          type: 'boolean',
          description: 'Whether the report has been sent back',
          optional: true,
        },
        isReopened: {
          type: 'boolean',
          description: 'Whether the report was reopened',
          optional: true,
        },
        isReportEverSentBack: {
          type: 'boolean',
          description: 'Whether the report was ever sent back',
          optional: true,
        },
        canRecall: {
          type: 'boolean',
          description: 'Whether the report can be recalled',
          optional: true,
        },
        canAddExpense: {
          type: 'boolean',
          description: 'Whether expenses can be added to the report',
          optional: true,
        },
        canReopen: {
          type: 'boolean',
          description: 'Whether the report can be reopened',
          optional: true,
        },
        isReceiptImageRequired: {
          type: 'boolean',
          description: 'Whether receipt images are required',
          optional: true,
        },
        isReceiptImageAvailable: {
          type: 'boolean',
          description: 'Whether receipt images are available',
          optional: true,
        },
        isPaperReceiptsReceived: {
          type: 'boolean',
          description: 'Whether paper receipts were received',
          optional: true,
        },
        isPendingDelegatorReview: {
          type: 'boolean',
          description: 'Whether pending delegator review',
          optional: true,
        },
        isFundsAndGrantsIntegrationEligible: {
          type: 'boolean',
          description: 'Funds and grants eligibility',
          optional: true,
        },
        hasReceivedCashAdvanceReturns: {
          type: 'boolean',
          description: 'Whether cash advance returns received',
          optional: true,
        },
        analyticsGroupId: { type: 'string', description: 'Analytics group ID', optional: true },
        hierarchyNodeId: { type: 'string', description: 'Hierarchy node ID', optional: true },
        allocationFormId: { type: 'string', description: 'Allocation form ID', optional: true },
        countryCode: { type: 'string', description: 'ISO country code', optional: true },
        countrySubDivisionCode: {
          type: 'string',
          description: 'ISO country subdivision code',
          optional: true,
        },
        country: { type: 'string', description: 'Country name', optional: true },
        businessPurpose: { type: 'string', description: 'Business purpose', optional: true },
        comment: {
          type: 'string',
          description: 'Header-level comment on the report',
          optional: true,
        },
        reportVersion: { type: 'number', description: 'Report version number', optional: true },
        reportType: { type: 'string', description: 'Report type identifier', optional: true },
        cardProgramStatementPeriodId: {
          type: 'string',
          description: 'Card program statement period ID',
          optional: true,
        },
        defaultFieldAccess: {
          type: 'string',
          description: 'Default field access (HD/RO/RW)',
          optional: true,
        },
        imageStatus: { type: 'string', description: 'Image status', optional: true },
        receiptContainerId: { type: 'string', description: 'Receipt container ID', optional: true },
        receiptStatus: { type: 'string', description: 'Receipt status', optional: true },
        sponsorId: { type: 'string', description: 'Sponsor ID', optional: true },
        submitterId: { type: 'string', description: 'Submitter user ID', optional: true },
        taxConfigId: { type: 'string', description: 'Tax configuration ID', optional: true },
        redirectFund: {
          type: 'json',
          description: 'Redirect fund object { amount, creditCardId }',
          optional: true,
        },
        customData: {
          type: 'array',
          description: 'Array of custom data { id, value, isValid, listItemUrl }',
          optional: true,
        },
        employee: {
          type: 'json',
          description: 'Employee object { employeeId, employeeUuid }',
          optional: true,
        },
        links: { type: 'array', description: 'HATEOAS links', optional: true },
      },
    },
  },
}
