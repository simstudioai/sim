import { QuickBooksIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { QuickBooksResponse } from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_CREATABLE_ENTITIES,
  QUICKBOOKS_DELETABLE_ENTITIES,
  QUICKBOOKS_PDF_ENTITIES,
  QUICKBOOKS_QUERYABLE_ENTITIES,
  QUICKBOOKS_READABLE_ENTITIES,
  QUICKBOOKS_REPORTS,
  QUICKBOOKS_UPDATABLE_ENTITIES,
} from '@/tools/quickbooks/types'

const LIST_OPERATIONS = ['list_records', 'list_vendors', 'list_purchase_orders', 'list_bills']
const RECORD_ID_OPERATIONS = [
  'get_record',
  'update_record',
  'delete_record',
  'download_document',
  'send_document',
]
const SYNC_TOKEN_OPERATIONS = ['update_record', 'delete_record']

const formatQuickBooksName = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2')
const buildEntityOptions = (entities: readonly string[]) =>
  entities.map((entity) => ({ label: formatQuickBooksName(entity), id: entity }))
const REPORT_LABELS: Record<string, string> = {
  AccountListDetail: 'Account List Detail',
  AgedPayableDetail: 'A/P Aging Detail',
  AgedPayables: 'A/P Aging Summary',
  AgedReceivableDetail: 'A/R Aging Detail',
  AgedReceivables: 'A/R Aging Summary',
  BalanceSheet: 'Balance Sheet',
  CashFlow: 'Statement of Cash Flows',
  ClassSales: 'Sales by Class',
  CustomerBalance: 'Customer Balance Summary',
  CustomerBalanceDetail: 'Customer Balance Detail',
  CustomerIncome: 'Income by Customer',
  CustomerSales: 'Sales by Customer',
  DepartmentSales: 'Sales by Department',
  GeneralLedgerDetail: 'General Ledger',
  InventoryValuationDetail: 'Inventory Valuation Detail',
  InventoryValuationSummary: 'Inventory Valuation Summary',
  ItemSales: 'Sales by Product/Service',
  ProfitAndLoss: 'Profit and Loss',
  ProfitAndLossDetail: 'Profit and Loss Detail',
  TaxSummary: 'Tax Summary',
  TrialBalance: 'Trial Balance',
  VendorBalance: 'Vendor Balance Summary',
  VendorBalanceDetail: 'Vendor Balance Detail',
  VendorExpenses: 'Expenses by Vendor',
}

export const QuickBooksBlock: BlockConfig<QuickBooksResponse> = {
  type: 'quickbooks',
  name: 'QuickBooks',
  description: 'Manage and report on QuickBooks Online accounting data',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate QuickBooks Online into procurement and accounting workflows. Manage supported records, inventory adjustments, preferences, currencies, reports, attachments, PDFs, change-data-capture syncs, batches, and custom queries.',
  docsLink: 'https://docs.sim.ai/integrations/quickbooks',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  bgColor: '#2CA01C',
  icon: QuickBooksIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Records', id: 'list_records' },
        { label: 'Get Record', id: 'get_record' },
        { label: 'Create Record', id: 'create_record' },
        { label: 'Update Record', id: 'update_record' },
        { label: 'Delete Record', id: 'delete_record' },
        { label: 'Run Report', id: 'run_report' },
        { label: 'Get Preferences', id: 'get_preferences' },
        { label: 'Update Preferences', id: 'update_preferences' },
        { label: 'Get Exchange Rate', id: 'get_exchange_rate' },
        { label: 'Update Exchange Rate', id: 'update_exchange_rate' },
        { label: 'Download Document PDF', id: 'download_document' },
        { label: 'Send Document', id: 'send_document' },
        { label: 'Upload Attachment', id: 'upload_attachment' },
        { label: 'Get Attachment URL', id: 'get_attachment_url' },
        { label: 'Get Changes', id: 'get_changes' },
        { label: 'Run Batch', id: 'batch' },
        { label: 'Run Query', id: 'query' },
        { label: 'List Vendors', id: 'list_vendors' },
        { label: 'List Purchase Orders', id: 'list_purchase_orders' },
        { label: 'List Bills', id: 'list_bills' },
      ],
      value: () => 'list_records',
    },
    {
      id: 'credential',
      title: 'QuickBooks Account',
      type: 'oauth-input',
      serviceId: 'quickbooks',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      requiredScopes: getScopesForService('quickbooks'),
      placeholder: 'Select QuickBooks account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'QuickBooks Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'realmId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'Company ID returned by Intuit as realmId',
      required: true,
    },
    {
      id: 'listEntity',
      title: 'Entity',
      type: 'dropdown',
      options: buildEntityOptions(QUICKBOOKS_QUERYABLE_ENTITIES),
      value: () => 'Vendor',
      condition: { field: 'operation', value: 'list_records' },
      required: { field: 'operation', value: 'list_records' },
    },
    {
      id: 'getEntity',
      title: 'Entity',
      type: 'dropdown',
      options: buildEntityOptions(QUICKBOOKS_READABLE_ENTITIES),
      value: () => 'Vendor',
      condition: { field: 'operation', value: 'get_record' },
      required: { field: 'operation', value: 'get_record' },
    },
    {
      id: 'createEntity',
      title: 'Entity',
      type: 'dropdown',
      options: buildEntityOptions(QUICKBOOKS_CREATABLE_ENTITIES),
      value: () => 'Vendor',
      condition: { field: 'operation', value: 'create_record' },
      required: { field: 'operation', value: 'create_record' },
    },
    {
      id: 'updateEntity',
      title: 'Entity',
      type: 'dropdown',
      options: buildEntityOptions(QUICKBOOKS_UPDATABLE_ENTITIES),
      value: () => 'Vendor',
      condition: { field: 'operation', value: 'update_record' },
      required: { field: 'operation', value: 'update_record' },
    },
    {
      id: 'deleteEntity',
      title: 'Entity',
      type: 'dropdown',
      options: buildEntityOptions(QUICKBOOKS_DELETABLE_ENTITIES),
      value: () => 'Bill',
      condition: { field: 'operation', value: 'delete_record' },
      required: { field: 'operation', value: 'delete_record' },
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'QuickBooks record ID',
      condition: { field: 'operation', value: RECORD_ID_OPERATIONS },
      required: { field: 'operation', value: RECORD_ID_OPERATIONS },
    },
    {
      id: 'syncToken',
      title: 'Sync Token',
      type: 'short-input',
      placeholder: 'Latest SyncToken from QuickBooks',
      condition: { field: 'operation', value: SYNC_TOKEN_OPERATIONS },
      required: { field: 'operation', value: SYNC_TOKEN_OPERATIONS },
    },
    {
      id: 'payload',
      title: 'Record Payload',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "DisplayName": "Acme Supplies"\n}',
      condition: {
        field: 'operation',
        value: [
          'create_record',
          'update_record',
          'delete_record',
          'update_exchange_rate',
          'update_preferences',
        ],
      },
      required: {
        field: 'operation',
        value: ['create_record', 'update_record', 'update_exchange_rate', 'update_preferences'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a QuickBooks Online Accounting API entity payload for the selected operation and entity. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the QuickBooks payload...',
        generationType: 'json-object',
      },
    },
    {
      id: 'pdfEntity',
      title: 'Transaction Type',
      type: 'dropdown',
      options: buildEntityOptions(QUICKBOOKS_PDF_ENTITIES),
      value: () => 'PurchaseOrder',
      condition: { field: 'operation', value: ['download_document', 'send_document'] },
      required: { field: 'operation', value: ['download_document', 'send_document'] },
    },
    {
      id: 'sendTo',
      title: 'Recipient Email',
      type: 'short-input',
      placeholder: 'Defaults to the email stored on the transaction',
      condition: { field: 'operation', value: 'send_document' },
      mode: 'advanced',
    },
    {
      id: 'sourceCurrencyCode',
      title: 'Source Currency',
      type: 'short-input',
      placeholder: 'EUR',
      condition: { field: 'operation', value: 'get_exchange_rate' },
      required: { field: 'operation', value: 'get_exchange_rate' },
    },
    {
      id: 'asOfDate',
      title: 'As Of Date',
      type: 'short-input',
      placeholder: '2026-01-31',
      condition: { field: 'operation', value: 'get_exchange_rate' },
      mode: 'advanced',
    },
    {
      id: 'attachmentFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      condition: { field: 'operation', value: 'upload_attachment' },
      required: { field: 'operation', value: 'upload_attachment' },
    },
    {
      id: 'attachmentEntity',
      title: 'Linked Entity Type',
      type: 'short-input',
      placeholder: 'PurchaseOrder',
      condition: { field: 'operation', value: 'upload_attachment' },
      required: { field: 'operation', value: 'upload_attachment' },
    },
    {
      id: 'attachmentEntityId',
      title: 'Linked Entity ID',
      type: 'short-input',
      placeholder: 'QuickBooks transaction or list entity ID',
      condition: { field: 'operation', value: 'upload_attachment' },
      required: { field: 'operation', value: 'upload_attachment' },
    },
    {
      id: 'attachmentNote',
      title: 'Note',
      type: 'long-input',
      placeholder: 'Receipt or supporting document details',
      condition: { field: 'operation', value: 'upload_attachment' },
      mode: 'advanced',
    },
    {
      id: 'includeOnSend',
      title: 'Include When Sending',
      type: 'switch',
      condition: { field: 'operation', value: 'upload_attachment' },
      mode: 'advanced',
    },
    {
      id: 'attachmentId',
      title: 'Attachment ID',
      type: 'short-input',
      placeholder: 'QuickBooks Attachable ID',
      condition: { field: 'operation', value: 'get_attachment_url' },
      required: { field: 'operation', value: 'get_attachment_url' },
    },
    {
      id: 'thumbnail',
      title: 'Thumbnail URL',
      type: 'switch',
      condition: { field: 'operation', value: 'get_attachment_url' },
      mode: 'advanced',
    },
    {
      id: 'sparse',
      title: 'Sparse Update',
      type: 'switch',
      value: () => 'true',
      condition: { field: 'operation', value: 'update_record' },
      mode: 'advanced',
    },
    {
      id: 'activeOnly',
      title: 'Active Vendors Only',
      type: 'switch',
      condition: { field: 'operation', value: 'list_vendors' },
    },
    {
      id: 'whereClause',
      title: 'Where Clause',
      type: 'long-input',
      placeholder: "Active = true AND MetaData.LastUpdatedTime >= '2026-01-01'",
      condition: { field: 'operation', value: 'list_records' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a QuickBooks Online query WHERE clause without the WHERE keyword. QuickBooks supports AND but not OR. Return ONLY the clause - no explanations, no extra text.',
        placeholder: 'Describe which QuickBooks records to include...',
      },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'MetaData.LastUpdatedTime DESC',
      condition: { field: 'operation', value: 'list_records' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a QuickBooks Online query ORDERBY clause without the ORDERBY keyword. Return ONLY the clause - no explanations, no extra text.',
        placeholder: 'Describe how the QuickBooks records should be sorted...',
      },
    },
    {
      id: 'startPosition',
      title: 'Start Position',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '1000 or less',
      mode: 'advanced',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    {
      id: 'query',
      title: 'Query',
      type: 'long-input',
      placeholder: 'SELECT * FROM Vendor MAXRESULTS 10',
      condition: { field: 'operation', value: 'query' },
      required: { field: 'operation', value: 'query' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a QuickBooks Online Accounting API SQL-like query. Return ONLY the query text - no explanations, no extra text.',
        placeholder: 'Describe what QuickBooks records to query...',
      },
    },
    {
      id: 'report',
      title: 'Report',
      type: 'dropdown',
      options: QUICKBOOKS_REPORTS.map((report) => ({
        label: REPORT_LABELS[report] ?? formatQuickBooksName(report),
        id: report,
      })),
      value: () => 'AgedPayables',
      condition: { field: 'operation', value: 'run_report' },
      required: { field: 'operation', value: 'run_report' },
    },
    {
      id: 'reportParams',
      title: 'Report Parameters',
      type: 'code',
      language: 'json',
      placeholder:
        '{\n  "start_date": "2026-01-01",\n  "end_date": "2026-01-31",\n  "accounting_method": "Accrual"\n}',
      condition: { field: 'operation', value: 'run_report' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate QuickBooks Reports API query parameters as a JSON object. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the report period, basis, and filters...',
        generationType: 'json-object',
      },
    },
    {
      id: 'entities',
      title: 'Entities',
      type: 'short-input',
      placeholder: 'Vendor,PurchaseOrder,Bill,BillPayment',
      condition: { field: 'operation', value: 'get_changes' },
      required: { field: 'operation', value: 'get_changes' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of QuickBooks Online entity names to track with change data capture. Return ONLY the comma-separated list - no explanations, no extra text.',
        placeholder: 'Describe which accounting records to monitor...',
      },
    },
    {
      id: 'changedSince',
      title: 'Changed Since',
      type: 'short-input',
      placeholder: '2026-01-15T09:00:00-08:00',
      condition: { field: 'operation', value: 'get_changes' },
      required: { field: 'operation', value: 'get_changes' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date-time within the last 30 days based on the user description. Return ONLY the timestamp - no explanations, no extra text.',
        placeholder: 'Describe when the change window should begin...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'batch',
      title: 'Batch Payload',
      type: 'code',
      language: 'json',
      placeholder:
        '{\n  "BatchItemRequest": [\n    {\n      "bId": "vendor-query",\n      "Query": "SELECT * FROM Vendor MAXRESULTS 10"\n    }\n  ]\n}',
      condition: { field: 'operation', value: 'batch' },
      required: { field: 'operation', value: 'batch' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a QuickBooks Online batch payload with at most 10 BatchItemRequest entries. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the QuickBooks operations to batch...',
        generationType: 'json-object',
      },
    },
    {
      id: 'minorVersion',
      title: 'Minor Version',
      type: 'short-input',
      placeholder: '75',
      mode: 'advanced',
    },
    {
      id: 'apiEnvironment',
      title: 'Environment',
      type: 'dropdown',
      options: [
        { label: 'Production', id: 'production' },
        { label: 'Sandbox', id: 'sandbox' },
      ],
      value: () => 'production',
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'quickbooks_batch',
      'quickbooks_create_record',
      'quickbooks_delete_record',
      'quickbooks_download_document',
      'quickbooks_get_attachment_url',
      'quickbooks_get_changes',
      'quickbooks_get_exchange_rate',
      'quickbooks_get_preferences',
      'quickbooks_get_record',
      'quickbooks_list_bills',
      'quickbooks_list_purchase_orders',
      'quickbooks_list_records',
      'quickbooks_list_vendors',
      'quickbooks_query',
      'quickbooks_run_report',
      'quickbooks_send_document',
      'quickbooks_update_exchange_rate',
      'quickbooks_update_preferences',
      'quickbooks_update_record',
      'quickbooks_upload_attachment',
    ],
    config: {
      tool: (params) => `quickbooks_${params.operation}`,
      params: (params) => {
        const entity =
          params.operation === 'list_records'
            ? params.listEntity
            : params.operation === 'get_record'
              ? params.getEntity
              : params.operation === 'create_record'
                ? params.createEntity
                : params.operation === 'update_record'
                  ? params.updateEntity
                  : params.operation === 'delete_record'
                    ? params.deleteEntity
                    : params.operation === 'download_document'
                      ? params.pdfEntity
                      : params.operation === 'send_document'
                        ? params.pdfEntity
                        : params.operation === 'upload_attachment'
                          ? params.attachmentEntity
                          : undefined
        return {
          credential: params.oauthCredential,
          realmId: params.realmId,
          entity,
          recordId: params.recordId,
          syncToken: params.syncToken,
          payload: params.payload,
          sparse: params.sparse,
          activeOnly: params.activeOnly,
          whereClause: params.whereClause,
          orderBy: params.orderBy,
          startPosition: params.startPosition,
          maxResults: params.maxResults,
          query: params.query,
          report: params.report,
          reportParams: params.reportParams,
          entities: params.entities,
          changedSince: params.changedSince,
          batch: params.batch,
          sourceCurrencyCode: params.sourceCurrencyCode,
          asOfDate: params.asOfDate,
          sendTo: params.sendTo,
          file: normalizeFileInput(params.file, { single: true }),
          attachmentId: params.attachmentId,
          thumbnail: params.thumbnail,
          entityId: params.attachmentEntityId,
          note: params.attachmentNote,
          includeOnSend: params.includeOnSend,
          apiEnvironment: params.apiEnvironment,
          minorVersion: params.minorVersion,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'QuickBooks operation to perform' },
    oauthCredential: { type: 'string', description: 'QuickBooks OAuth credential' },
    realmId: {
      type: 'string',
      description: 'QuickBooks company ID returned by Intuit as realmId during OAuth',
    },
    activeOnly: { type: 'boolean', description: 'Only return active vendors' },
    listEntity: { type: 'string', description: 'QuickBooks entity to list' },
    getEntity: { type: 'string', description: 'QuickBooks entity to read' },
    createEntity: { type: 'string', description: 'QuickBooks entity to create' },
    updateEntity: { type: 'string', description: 'QuickBooks entity to update' },
    deleteEntity: { type: 'string', description: 'QuickBooks entity to delete' },
    recordId: { type: 'string', description: 'QuickBooks record ID' },
    syncToken: { type: 'string', description: 'Latest QuickBooks record SyncToken' },
    payload: { type: 'json', description: 'QuickBooks entity payload' },
    sparse: { type: 'boolean', description: 'Whether to perform a sparse update' },
    whereClause: { type: 'string', description: 'QuickBooks query WHERE clause' },
    orderBy: { type: 'string', description: 'QuickBooks query ORDERBY clause' },
    startPosition: { type: 'string', description: 'One-based start position for pagination' },
    maxResults: { type: 'string', description: 'Maximum number of records to return, up to 1000' },
    query: { type: 'string', description: 'QuickBooks SQL-like query to execute' },
    report: { type: 'string', description: 'QuickBooks report endpoint name' },
    reportParams: { type: 'json', description: 'QuickBooks report query parameters' },
    entities: { type: 'string', description: 'QuickBooks CDC entity list' },
    changedSince: { type: 'string', description: 'QuickBooks CDC look-back date-time' },
    batch: { type: 'json', description: 'QuickBooks batch request payload' },
    pdfEntity: { type: 'string', description: 'QuickBooks transaction type for PDF download' },
    sourceCurrencyCode: { type: 'string', description: 'ISO 4217 source currency code' },
    asOfDate: { type: 'string', description: 'Exchange rate effective date' },
    sendTo: { type: 'string', description: 'Optional document recipient email address' },
    file: { type: 'file', description: 'File to upload to QuickBooks' },
    attachmentEntity: { type: 'string', description: 'QuickBooks entity linked to the file' },
    attachmentEntityId: { type: 'string', description: 'QuickBooks entity ID linked to the file' },
    attachmentNote: { type: 'string', description: 'QuickBooks attachment note' },
    includeOnSend: {
      type: 'boolean',
      description: 'Whether QuickBooks includes the attachment when sending',
    },
    attachmentId: { type: 'string', description: 'QuickBooks Attachable ID' },
    thumbnail: { type: 'boolean', description: 'Whether to request a thumbnail URL' },
    apiEnvironment: {
      type: 'string',
      description: 'QuickBooks API environment: production or sandbox',
    },
    minorVersion: { type: 'string', description: 'QuickBooks Accounting API minor version' },
  },
  outputs: {
    items: {
      type: 'json',
      description: 'QuickBooks records returned by the query',
    },
    entity: {
      type: 'string',
      description: 'QuickBooks entity name returned by the query',
    },
    totalCount: {
      type: 'number',
      description: 'Total count returned by QuickBooks for the query',
    },
    startPosition: {
      type: 'number',
      description: 'Start position returned by QuickBooks',
    },
    maxResults: {
      type: 'number',
      description: 'Maximum records returned by QuickBooks',
    },
    query: {
      type: 'string',
      description: 'Query that was executed',
    },
    record: {
      type: 'json',
      description: 'Entity-specific QuickBooks record returned by a CRUD operation',
    },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
    },
    report: {
      type: 'string',
      description: 'QuickBooks report endpoint name',
    },
    header: {
      type: 'json',
      description: 'QuickBooks report header metadata',
    },
    columns: {
      type: 'json',
      description: 'QuickBooks report column definitions',
    },
    rows: {
      type: 'json',
      description: 'QuickBooks report rows and nested sections',
    },
    changes: {
      type: 'json',
      description: 'Changed QuickBooks records grouped by entity',
    },
    changedSince: {
      type: 'string',
      description: 'Requested QuickBooks CDC look-back date-time',
    },
    mayBeTruncated: {
      type: 'boolean',
      description: 'Whether the QuickBooks CDC response may have reached its object limit',
    },
    batchItems: {
      type: 'json',
      description: 'QuickBooks batch item responses in request order',
    },
    file: {
      type: 'file',
      description: 'QuickBooks transaction PDF',
    },
    url: {
      type: 'string',
      description: 'Temporary QuickBooks attachment URL',
    },
    attachmentId: {
      type: 'string',
      description: 'QuickBooks Attachable ID',
    },
    thumbnail: {
      type: 'boolean',
      description: 'Whether the attachment URL is for a thumbnail',
    },
    result: {
      type: 'json',
      description: 'QuickBooks attachment upload response',
    },
  },
}

export const QuickBooksBlockMeta = {
  tags: ['payments', 'automation'],
  url: 'https://quickbooks.intuit.com',
  templates: [
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks vendor intake',
      prompt:
        'Build a workflow that lists QuickBooks vendors, compares them against submitted procurement requests in a table, and flags requests that reference unknown vendors.',
      modules: ['workflows', 'tables'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks purchase order monitor',
      prompt:
        'Build a scheduled workflow that lists recent QuickBooks purchase orders, summarizes new commitments by vendor, and posts the digest to a Slack channel.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks bill approval queue',
      prompt:
        'Build a scheduled workflow that lists QuickBooks bills, identifies bills with open balances, and emails finance a queue grouped by due date.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks procurement assistant',
      prompt:
        'Build an agent that answers procurement questions by querying QuickBooks vendors, bills, and purchase orders on demand.',
      modules: ['agent'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks vendor spend report',
      prompt:
        'Build a weekly workflow that queries QuickBooks bills, rolls up total open balance by vendor, stores the result in a table, and emails the report to finance.',
      modules: ['workflows', 'scheduled', 'tables'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks purchase order reconciliation',
      prompt:
        'Build a workflow that lists QuickBooks purchase orders and bills, matches them by vendor and amount, and flags bills without a matching purchase order.',
      modules: ['workflows', 'tables'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks aging alert',
      prompt:
        'Build a scheduled workflow that queries QuickBooks bills by due date and sends a Slack alert for any unpaid bills due this week.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'vendor-master-audit',
      description: 'Compare procurement requests against active QuickBooks vendors.',
      content:
        '# Vendor Master Audit\n\nCheck whether procurement requests reference vendors that exist in QuickBooks Online.\n\n## Steps\n1. List vendors from QuickBooks with activeOnly enabled.\n2. Compare the vendor names or IDs in the incoming request table against the returned vendor records.\n3. Flag requests that do not match an active vendor.\n4. Route flagged rows to the procurement owner for review.\n\n## Output\nReturn the matched vendors, unmatched requests, and a short summary of follow-up work.',
    },
    {
      name: 'open-bill-aging-alert',
      description: 'Find open QuickBooks bills that need attention before payment deadlines.',
      content:
        '# Open Bill Aging Alert\n\nMonitor unpaid QuickBooks bills and surface near-term payment risk.\n\n## Steps\n1. Query QuickBooks bills with a MAXRESULTS limit and the needed date filters.\n2. Identify bills with an open Balance and group them by due date or vendor.\n3. Summarize the highest-priority bills for finance.\n4. Send the summary to the preferred notification channel.\n\n## Output\nReturn the overdue or upcoming bills, grouped totals, and the notification text.',
    },
    {
      name: 'purchase-order-monitor',
      description: 'Summarize recent QuickBooks purchase orders for procurement review.',
      content:
        '# Purchase Order Monitor\n\nTrack recent purchase order activity in QuickBooks Online.\n\n## Steps\n1. List or query QuickBooks purchase orders for the review window.\n2. Group purchase orders by vendor and transaction date.\n3. Highlight high-value or unusual purchase orders for manual review.\n4. Save or send the procurement digest.\n\n## Output\nReturn the reviewed purchase orders, vendor totals, and a concise digest.',
    },
    {
      name: 'po-bill-reconciliation',
      description: 'Compare QuickBooks purchase orders and bills to spot mismatches.',
      content:
        '# PO Bill Reconciliation\n\nUse QuickBooks purchase orders and bills to identify possible matching issues.\n\n## Steps\n1. List purchase orders and bills for the same company and time window.\n2. Match records by vendor, date, document number, or amount where available.\n3. Flag bills without a likely purchase order match.\n4. Summarize exceptions for accounting review.\n\n## Output\nReturn matched records, unmatched bills, and the reconciliation summary.',
    },
    {
      name: 'vendor-spend-summary',
      description: 'Roll up QuickBooks bill data into a vendor spend summary.',
      content:
        '# Vendor Spend Summary\n\nCreate a vendor-level spend view from QuickBooks bill records.\n\n## Steps\n1. Query QuickBooks bills with a bounded MAXRESULTS value.\n2. Group bill totals and balances by vendor reference when present.\n3. Rank vendors by total amount or open balance.\n4. Store or send the summarized report.\n\n## Output\nReturn vendor totals, open balances, and a short explanation of the largest spend drivers.',
    },
  ],
} as const satisfies BlockMeta
