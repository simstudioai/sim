import {
  INVOICE_OUTPUT_PROPERTIES,
  mapInvoice,
  mapPagination,
  PAGINATION_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneInvoiceListParams,
  type RocketlaneInvoiceListResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneListInvoicesTool: ToolConfig<
  RocketlaneInvoiceListParams,
  RocketlaneInvoiceListResponse
> = {
  id: 'rocketlane_list_invoices',
  name: 'Rocketlane List Invoices',
  description:
    'Search invoices in Rocketlane with date, amount, company, invoice-number, and status filters, sorting, and pagination',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of invoices per page (defaults to 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response (valid for 15 minutes)',
    },
    includeFields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional fields to include in the response: notes, attachments',
      items: { type: 'string' },
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return all fields in the response',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort by: createdAt or invoiceNumber',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: ASC or DESC (defaults to DESC)',
    },
    match: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Combine filters with AND (all) or OR (any); defaults to all',
    },
    dateOfIssueEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by date of issue equal to this date (YYYY-MM-DD)',
    },
    dateOfIssueGt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by date of issue greater than this date (YYYY-MM-DD)',
    },
    dateOfIssueGe: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by date of issue greater than or equal to this date (YYYY-MM-DD)',
    },
    dateOfIssueLt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by date of issue less than this date (YYYY-MM-DD)',
    },
    dateOfIssueLe: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by date of issue less than or equal to this date (YYYY-MM-DD)',
    },
    dueDateEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by due date equal to this date (YYYY-MM-DD)',
    },
    dueDateGt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by due date greater than this date (YYYY-MM-DD)',
    },
    dueDateGe: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by due date greater than or equal to this date (YYYY-MM-DD)',
    },
    dueDateLt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by due date less than this date (YYYY-MM-DD)',
    },
    dueDateLe: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by due date less than or equal to this date (YYYY-MM-DD)',
    },
    amountEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by total amount equal to this value',
    },
    amountGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by total amount greater than this value',
    },
    amountGe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by total amount greater than or equal to this value',
    },
    amountLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by total amount less than this value',
    },
    amountLe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by total amount less than or equal to this value',
    },
    amountOutstandingEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount outstanding equal to this value',
    },
    amountOutstandingGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount outstanding greater than this value',
    },
    amountOutstandingGe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount outstanding greater than or equal to this value',
    },
    amountOutstandingLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount outstanding less than this value',
    },
    amountOutstandingLe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount outstanding less than or equal to this value',
    },
    amountPaidEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount paid equal to this value',
    },
    amountPaidGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount paid greater than this value',
    },
    amountPaidGe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount paid greater than or equal to this value',
    },
    amountPaidLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount paid less than this value',
    },
    amountPaidLe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount paid less than or equal to this value',
    },
    amountWrittenOffEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount written off equal to this value',
    },
    amountWrittenOffGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount written off greater than this value',
    },
    amountWrittenOffGe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount written off greater than or equal to this value',
    },
    amountWrittenOffLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount written off less than this value',
    },
    amountWrittenOffLe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by amount written off less than or equal to this value',
    },
    createdAtEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by created timestamp equal to this value (epoch milliseconds)',
    },
    createdAtGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by created timestamp greater than this value (epoch milliseconds)',
    },
    createdAtGe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by created timestamp greater than or equal to this value (epoch milliseconds)',
    },
    createdAtLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by created timestamp less than this value (epoch milliseconds)',
    },
    createdAtLe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by created timestamp less than or equal to this value (epoch milliseconds)',
    },
    companyIdEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return invoices that exactly match this customer company ID',
    },
    companyIdOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated customer company IDs to match any of',
    },
    companyIdNoneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated customer company IDs to match none of',
    },
    invoiceNumberEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return invoices whose invoice number equals this value',
    },
    invoiceNumberCn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return invoices whose invoice number contains this text',
    },
    invoiceNumberNc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return invoices whose invoice number does not contain this text',
    },
    statusEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return invoices that equal this status (e.g. DRAFT)',
    },
    statusOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated statuses to match any of (e.g. DRAFT,PAID)',
    },
    statusNoneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated statuses to match none of (e.g. DRAFT,PAID)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/invoices`)
      if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.includeFields?.length) {
        url.searchParams.set('includeFields', params.includeFields.join(','))
      }
      if (params.includeAllFields != null) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy)
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
      if (params.match) url.searchParams.set('match', params.match)
      if (params.dateOfIssueEq) url.searchParams.set('dateOfIssue.eq', params.dateOfIssueEq)
      if (params.dateOfIssueGt) url.searchParams.set('dateOfIssue.gt', params.dateOfIssueGt)
      if (params.dateOfIssueGe) url.searchParams.set('dateOfIssue.ge', params.dateOfIssueGe)
      if (params.dateOfIssueLt) url.searchParams.set('dateOfIssue.lt', params.dateOfIssueLt)
      if (params.dateOfIssueLe) url.searchParams.set('dateOfIssue.le', params.dateOfIssueLe)
      if (params.dueDateEq) url.searchParams.set('dueDate.eq', params.dueDateEq)
      if (params.dueDateGt) url.searchParams.set('dueDate.gt', params.dueDateGt)
      if (params.dueDateGe) url.searchParams.set('dueDate.ge', params.dueDateGe)
      if (params.dueDateLt) url.searchParams.set('dueDate.lt', params.dueDateLt)
      if (params.dueDateLe) url.searchParams.set('dueDate.le', params.dueDateLe)
      if (params.amountEq != null) url.searchParams.set('amount.eq', String(params.amountEq))
      if (params.amountGt != null) url.searchParams.set('amount.gt', String(params.amountGt))
      if (params.amountGe != null) url.searchParams.set('amount.ge', String(params.amountGe))
      if (params.amountLt != null) url.searchParams.set('amount.lt', String(params.amountLt))
      if (params.amountLe != null) url.searchParams.set('amount.le', String(params.amountLe))
      if (params.amountOutstandingEq != null) {
        url.searchParams.set('amountOutstanding.eq', String(params.amountOutstandingEq))
      }
      if (params.amountOutstandingGt != null) {
        url.searchParams.set('amountOutstanding.gt', String(params.amountOutstandingGt))
      }
      if (params.amountOutstandingGe != null) {
        url.searchParams.set('amountOutstanding.ge', String(params.amountOutstandingGe))
      }
      if (params.amountOutstandingLt != null) {
        url.searchParams.set('amountOutstanding.lt', String(params.amountOutstandingLt))
      }
      if (params.amountOutstandingLe != null) {
        url.searchParams.set('amountOutstanding.le', String(params.amountOutstandingLe))
      }
      if (params.amountPaidEq != null) {
        url.searchParams.set('amountPaid.eq', String(params.amountPaidEq))
      }
      if (params.amountPaidGt != null) {
        url.searchParams.set('amountPaid.gt', String(params.amountPaidGt))
      }
      if (params.amountPaidGe != null) {
        url.searchParams.set('amountPaid.ge', String(params.amountPaidGe))
      }
      if (params.amountPaidLt != null) {
        url.searchParams.set('amountPaid.lt', String(params.amountPaidLt))
      }
      if (params.amountPaidLe != null) {
        url.searchParams.set('amountPaid.le', String(params.amountPaidLe))
      }
      if (params.amountWrittenOffEq != null) {
        url.searchParams.set('amountWrittenOff.eq', String(params.amountWrittenOffEq))
      }
      if (params.amountWrittenOffGt != null) {
        url.searchParams.set('amountWrittenOff.gt', String(params.amountWrittenOffGt))
      }
      if (params.amountWrittenOffGe != null) {
        url.searchParams.set('amountWrittenOff.ge', String(params.amountWrittenOffGe))
      }
      if (params.amountWrittenOffLt != null) {
        url.searchParams.set('amountWrittenOff.lt', String(params.amountWrittenOffLt))
      }
      if (params.amountWrittenOffLe != null) {
        url.searchParams.set('amountWrittenOff.le', String(params.amountWrittenOffLe))
      }
      if (params.createdAtEq != null) {
        url.searchParams.set('createdAt.eq', String(params.createdAtEq))
      }
      if (params.createdAtGt != null) {
        url.searchParams.set('createdAt.gt', String(params.createdAtGt))
      }
      if (params.createdAtGe != null) {
        url.searchParams.set('createdAt.ge', String(params.createdAtGe))
      }
      if (params.createdAtLt != null) {
        url.searchParams.set('createdAt.lt', String(params.createdAtLt))
      }
      if (params.createdAtLe != null) {
        url.searchParams.set('createdAt.le', String(params.createdAtLe))
      }
      if (params.companyIdEq) url.searchParams.set('companyId.eq', params.companyIdEq)
      if (params.companyIdOneOf) url.searchParams.set('companyId.oneOf', params.companyIdOneOf)
      if (params.companyIdNoneOf) {
        url.searchParams.set('companyId.noneOf', params.companyIdNoneOf)
      }
      if (params.invoiceNumberEq) {
        url.searchParams.set('invoiceNumber.eq', params.invoiceNumberEq)
      }
      if (params.invoiceNumberCn) {
        url.searchParams.set('invoiceNumber.cn', params.invoiceNumberCn)
      }
      if (params.invoiceNumberNc) {
        url.searchParams.set('invoiceNumber.nc', params.invoiceNumberNc)
      }
      if (params.statusEq) url.searchParams.set('status.eq', params.statusEq)
      if (params.statusOneOf) url.searchParams.set('status.oneOf', params.statusOneOf)
      if (params.statusNoneOf) url.searchParams.set('status.noneOf', params.statusNoneOf)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    const invoices = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        invoices: invoices.map(mapInvoice),
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    invoices: {
      type: 'array',
      description: 'List of invoices',
      items: { type: 'object', properties: INVOICE_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details for the result set',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
