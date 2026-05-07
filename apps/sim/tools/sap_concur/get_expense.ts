import type { GetExpenseParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getExpenseTool: ToolConfig<GetExpenseParams, SapConcurProxyResponse> = {
  id: 'sap_concur_get_expense',
  name: 'SAP Concur Get Expense',
  description:
    'Get a single expense (GET /expensereports/v4/users/{userId}/context/{contextType}/reports/{reportId}/expenses/{expenseId}).',
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
      description: 'Concur user UUID',
    },
    contextType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Access context: TRAVELER, MANAGER, or PROXY',
    },
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense report ID',
    },
    expenseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense ID',
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
      const expenseId = trimRequired(params.expenseId, 'expenseId')
      return {
        ...baseProxyBody(params),
        path: `/expensereports/v4/users/${encodeURIComponent(userId)}/context/${encodeURIComponent(contextType)}/reports/${encodeURIComponent(reportId)}/expenses/${encodeURIComponent(expenseId)}`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Expense detail (ReportExpenseDetail) payload',
      properties: {
        expenseId: { type: 'string', description: 'Expense identifier', optional: true },
        allocationSetId: {
          type: 'string',
          description: 'Identifier of the associated allocation set',
          optional: true,
        },
        allocationState: {
          type: 'string',
          description: 'FULLY_ALLOCATED, NOT_ALLOCATED, or PARTIALLY_ALLOCATED',
          optional: true,
        },
        expenseType: {
          type: 'json',
          description: 'Expense type {id, name, code, isDeleted}',
          optional: true,
        },
        paymentType: {
          type: 'json',
          description: 'Payment type {id, name, code}',
          optional: true,
        },
        expenseSource: {
          type: 'string',
          description: 'Source of the expense (CASH, CCARD, EBOOKING, etc.)',
          optional: true,
        },
        transactionDate: {
          type: 'string',
          description: 'Transaction date (YYYY-MM-DD)',
          optional: true,
        },
        budgetAccrualDate: {
          type: 'string',
          description: 'Budget accrual date',
          optional: true,
        },
        transactionAmount: {
          type: 'json',
          description: 'Transaction amount {currencyCode, value}',
          optional: true,
        },
        postedAmount: {
          type: 'json',
          description: 'Posted amount in report currency {currencyCode, value}',
          optional: true,
        },
        claimedAmount: {
          type: 'json',
          description: 'Non-personal claimed amount {currencyCode, value}',
          optional: true,
        },
        approvedAmount: {
          type: 'json',
          description: 'Approved amount {currencyCode, value}',
          optional: true,
        },
        approverAdjustedAmount: {
          type: 'json',
          description: 'Total amount adjusted by the approver',
          optional: true,
        },
        exchangeRate: {
          type: 'json',
          description: 'Exchange rate {value, operation}',
          optional: true,
        },
        vendor: {
          type: 'json',
          description: 'Vendor info {id, name, description}',
          optional: true,
        },
        location: {
          type: 'json',
          description: 'Location {id, name, city, countryCode, countrySubDivisionCode}',
          optional: true,
        },
        businessPurpose: {
          type: 'string',
          description: 'Business purpose',
          optional: true,
        },
        comment: {
          type: 'string',
          description: 'Free-form comment associated with the expense',
          optional: true,
        },
        isExpenseBillable: {
          type: 'boolean',
          description: 'Billable flag',
          optional: true,
        },
        isPersonalExpense: {
          type: 'boolean',
          description: 'Personal-expense flag',
          optional: true,
        },
        isExpenseRejected: {
          type: 'boolean',
          description: 'Whether the expense was rejected',
          optional: true,
        },
        isExcludedFromCashAdvanceByUser: {
          type: 'boolean',
          description: 'Whether the user excluded this from cash advance',
          optional: true,
        },
        isImageRequired: {
          type: 'boolean',
          description: 'Whether a receipt image is required',
          optional: true,
        },
        isPaperReceiptRequired: {
          type: 'boolean',
          description: 'Whether a paper receipt is required',
          optional: true,
        },
        isPaperReceiptReceived: {
          type: 'boolean',
          description: 'Whether a paper receipt was received',
          optional: true,
        },
        isAutoCreated: {
          type: 'boolean',
          description: 'Auto-creation indicator',
          optional: true,
        },
        hasBlockingExceptions: {
          type: 'boolean',
          description: 'Whether submission-blocking exceptions exist',
          optional: true,
        },
        hasExceptions: {
          type: 'boolean',
          description: 'Whether any exceptions exist',
          optional: true,
        },
        hasMissingReceiptDeclaration: {
          type: 'boolean',
          description: 'Affidavit declaration status',
          optional: true,
        },
        attendeeCount: {
          type: 'number',
          description: 'Number of attendees',
          optional: true,
        },
        receiptImageId: {
          type: 'string',
          description: 'Identifier of the attached receipt image',
          optional: true,
        },
        ereceiptImageId: {
          type: 'string',
          description: 'eReceipt image identifier',
          optional: true,
        },
        receiptType: {
          type: 'json',
          description: 'Receipt {id, status}',
          optional: true,
        },
        imageCertificationStatus: {
          type: 'string',
          description: 'Receipt image processing/certification status',
          optional: true,
        },
        ticketNumber: {
          type: 'string',
          description: 'Associated travel ticket number',
          optional: true,
        },
        travel: {
          type: 'json',
          description: 'Travel data (airline, car rental, hotel, etc.)',
          optional: true,
        },
        travelAllowance: {
          type: 'json',
          description: 'Travel allowance association data',
          optional: true,
        },
        mileage: {
          type: 'json',
          description: 'Mileage details (odometerStart, odometerEnd, totalDistance, ...)',
          optional: true,
        },
        expenseTaxSummary: {
          type: 'json',
          description: 'Aggregated tax data for the expense',
          optional: true,
        },
        taxRateLocation: {
          type: 'string',
          description: 'Tax rate location: FOREIGN, HOME, or OUT_OF_PROVINCE',
          optional: true,
        },
        fuelTypeListItem: {
          type: 'json',
          description: 'Fuel type list item {id, value, isValid}',
          optional: true,
        },
        merchantTaxId: {
          type: 'string',
          description: 'Merchant tax identifier',
          optional: true,
        },
        customData: {
          type: 'json',
          description: 'Array of custom field values [{id, value, isValid}]',
          optional: true,
        },
        parentExpenseId: {
          type: 'string',
          description: 'Identifier of the parent expense (for itemizations)',
          optional: true,
        },
        authorizationRequestExpenseId: {
          type: 'string',
          description: 'Linked travel-request expected expense identifier',
          optional: true,
        },
        jptRouteId: {
          type: 'string',
          description: 'Japan Public Transport route id',
          optional: true,
        },
        invoiceId: { type: 'string', description: 'Invoice identifier', optional: true },
        governmentInvoiceId: {
          type: 'string',
          description: 'Government invoice identifier',
          optional: true,
        },
        lastModifiedDate: {
          type: 'string',
          description: 'Last modified timestamp',
          optional: true,
        },
        expenseSourceIdentifiers: {
          type: 'json',
          description: 'Source reference identifiers',
          optional: true,
        },
        links: {
          type: 'json',
          description: 'HATEOAS links for the expense',
          optional: true,
        },
      },
    },
  },
}
