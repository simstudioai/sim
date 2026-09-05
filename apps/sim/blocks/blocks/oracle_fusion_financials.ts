import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const normalized = value.trim()
  return normalized || undefined
}

function optionalWriteString(value: unknown) {
  return value === '' ? undefined : value
}

function optionalWriteNumber(value: unknown, label: string) {
  return value === null ? null : parseOptionalNumberInput(value, label)
}

function optionalWriteBoolean(value: unknown) {
  return value === null ? null : parseOptionalBooleanInput(value)
}

function optionalWriteJson(value: unknown, label: string) {
  return value === null ? null : parseOptionalJsonInput(value, label)
}

function financialsWriteParams(operation: string, params: Record<string, unknown>) {
  switch (operation) {
    case 'oracle_fusion_financials_create_receivables_invoice':
      return {
        businessUnit: optionalWriteString(params.businessUnit),
        transactionNumber: optionalWriteString(params.transactionNumber),
        transactionDate: optionalWriteString(params.transactionDate),
        accountingDate: optionalWriteString(params.accountingDate),
        billToCustomerName: optionalWriteString(params.billToCustomerName),
        billToCustomerNumber: optionalWriteString(params.billToCustomerNumber),
        billToSite: optionalWriteString(params.billToSite),
        invoiceCurrencyCode: optionalWriteString(params.invoiceCurrencyCode),
        invoiceStatus: optionalWriteString(params.invoiceStatus),
        paymentTerms: optionalWriteString(params.paymentTerms),
        transactionSource: optionalWriteString(params.transactionSource),
        transactionType: optionalWriteString(params.transactionType),
        comments: optionalWriteString(params.comments),
        purchaseOrder: optionalWriteString(params.purchaseOrder),
        conversionRateType: optionalWriteString(params.conversionRateType),
        conversionRate: optionalWriteNumber(params.conversionRate, 'Conversion Rate'),
        conversionDate: optionalWriteString(params.conversionDate),
        lines: optionalWriteJson(params.lines, 'Lines'),
        distributions: optionalWriteJson(params.distributions, 'Distributions'),
      }
    case 'oracle_fusion_financials_update_receivables_invoice':
      return {
        invoiceStatus: optionalWriteString(params.invoiceStatus),
        paymentTerms: optionalWriteString(params.paymentTerms),
        transactionDate: optionalWriteString(params.transactionDate),
      }
    case 'oracle_fusion_financials_approve_receivables_invoice':
      return {
        comment: optionalWriteString(params.comment),
      }
    case 'oracle_fusion_financials_rework_receivables_invoice':
      return {
        comment: optionalWriteString(params.comment),
      }
    case 'oracle_fusion_financials_create_receivables_invoice_line':
      return {
        lineNumber: optionalWriteNumber(params.lineNumber, 'Line Number'),
        description: optionalWriteString(params.description),
        itemNumber: optionalWriteString(params.itemNumber),
        memoLine: optionalWriteString(params.memoLine),
        lineAmount: optionalWriteNumber(params.lineAmount, 'Line Amount'),
        quantity: optionalWriteNumber(params.quantity, 'Quantity'),
        unitSellingPrice: optionalWriteNumber(params.unitSellingPrice, 'Unit Selling Price'),
        unitOfMeasure: optionalWriteString(params.unitOfMeasure),
        accountingRule: optionalWriteString(params.accountingRule),
        accountingRuleDuration: optionalWriteString(params.accountingRuleDuration),
        ruleStartDate: optionalWriteString(params.ruleStartDate),
        ruleEndDate: optionalWriteString(params.ruleEndDate),
        taxClassificationCode: optionalWriteString(params.taxClassificationCode),
        salesOrder: optionalWriteString(params.salesOrder),
      }
    case 'oracle_fusion_financials_create_receivables_invoice_distribution':
      return {
        accountClass: optionalWriteString(params.accountClass),
        accountCombination: optionalWriteString(params.accountCombination),
        accountedAmount: optionalWriteNumber(params.accountedAmount, 'Accounted Amount'),
        amount: optionalWriteNumber(params.amount, 'Amount'),
        invoiceLineNumber: optionalWriteNumber(params.invoiceLineNumber, 'Invoice Line Number'),
        detailedTaxLineNumber: optionalWriteNumber(
          params.detailedTaxLineNumber,
          'Detailed Tax Line Number'
        ),
        percent: optionalWriteNumber(params.percent, 'Percent'),
        comments: optionalWriteString(params.comments),
      }
    case 'oracle_fusion_financials_update_receivables_invoice_installment':
      return {
        installmentDueDate: optionalWriteString(params.installmentDueDate),
        originalAmount: optionalWriteNumber(params.originalAmount, 'Original Amount'),
      }
    case 'oracle_fusion_financials_create_receivables_credit_memo':
      return {
        businessUnit: optionalWriteString(params.businessUnit),
        transactionNumber: optionalWriteString(params.transactionNumber),
        transactionDate: optionalWriteString(params.transactionDate),
        accountingDate: optionalWriteString(params.accountingDate),
        billToCustomerName: optionalWriteString(params.billToCustomerName),
        billToCustomerNumber: optionalWriteString(params.billToCustomerNumber),
        billToSite: optionalWriteString(params.billToSite),
        creditMemoCurrency: optionalWriteString(params.creditMemoCurrency),
        creditMemoStatus: optionalWriteString(params.creditMemoStatus),
        creditReason: optionalWriteString(params.creditReason),
        freightCreditAmount: optionalWriteString(params.freightCreditAmount),
        transactionSource: optionalWriteString(params.transactionSource),
        transactionType: optionalWriteString(params.transactionType),
        creditMemoComments: optionalWriteString(params.creditMemoComments),
        conversionRate: optionalWriteNumber(params.conversionRate, 'Conversion Rate'),
        conversionRateType: optionalWriteString(params.conversionRateType),
        conversionRateDate: optionalWriteString(params.conversionRateDate),
        lines: optionalWriteJson(params.lines, 'Lines'),
        distributions: optionalWriteJson(params.distributions, 'Distributions'),
      }
    case 'oracle_fusion_financials_update_receivables_credit_memo':
      return {
        allowCompletion: optionalWriteString(params.allowCompletion),
        controlCompletionReason: optionalWriteString(params.controlCompletionReason),
        creditMemoStatus: optionalWriteString(params.creditMemoStatus),
        recipientEmail: optionalWriteString(params.recipientEmail),
        transactionType: optionalWriteString(params.transactionType),
      }
    case 'oracle_fusion_financials_approve_receivables_credit_memo':
      return {
        comment: optionalWriteString(params.comment),
      }
    case 'oracle_fusion_financials_rework_receivables_credit_memo':
      return {
        comment: optionalWriteString(params.comment),
      }
    case 'oracle_fusion_financials_create_receivables_credit_memo_line':
      return {
        lineNumber: optionalWriteNumber(params.lineNumber, 'Line Number'),
        lineDescription: optionalWriteString(params.lineDescription),
        itemNumber: optionalWriteString(params.itemNumber),
        memoLine: optionalWriteString(params.memoLine),
        lineAmountCredit: optionalWriteNumber(params.lineAmountCredit, 'Line Amount Credit'),
        lineQuantityCredit: optionalWriteNumber(params.lineQuantityCredit, 'Line Quantity Credit'),
        unitSellingPrice: optionalWriteNumber(params.unitSellingPrice, 'Unit Selling Price'),
        unitOfMeasure: optionalWriteString(params.unitOfMeasure),
        lineCreditReason: optionalWriteString(params.lineCreditReason),
        lineFreightCreditAmount: optionalWriteNumber(
          params.lineFreightCreditAmount,
          'Line Freight Credit Amount'
        ),
        taxClassificationCode: optionalWriteString(params.taxClassificationCode),
      }
    case 'oracle_fusion_financials_create_receivables_credit_memo_distribution':
      return {
        accountClass: optionalWriteString(params.accountClass),
        accountCombination: optionalWriteString(params.accountCombination),
        accountedAmount: optionalWriteNumber(params.accountedAmount, 'Accounted Amount'),
        amount: optionalWriteNumber(params.amount, 'Amount'),
        creditMemoLineNumber: optionalWriteNumber(
          params.creditMemoLineNumber,
          'Credit Memo Line Number'
        ),
        detailedTaxLineNumber: optionalWriteNumber(
          params.detailedTaxLineNumber,
          'Detailed Tax Line Number'
        ),
        percent: optionalWriteNumber(params.percent, 'Percent'),
        comments: optionalWriteString(params.comments),
      }
    case 'oracle_fusion_financials_create_receivables_receipt':
      return {
        amount: optionalWriteNumber(params.amount, 'Amount'),
        businessUnit: optionalWriteString(params.businessUnit),
        currency: optionalWriteString(params.currency),
        receiptDate: optionalWriteString(params.receiptDate),
        receiptMethod: optionalWriteString(params.receiptMethod),
        receiptNumber: optionalWriteString(params.receiptNumber),
        accountingDate: optionalWriteString(params.accountingDate),
        customerAccountNumber: optionalWriteString(params.customerAccountNumber),
        customerName: optionalWriteString(params.customerName),
        customerSite: optionalWriteString(params.customerSite),
        comments: optionalWriteString(params.comments),
        conversionRate: optionalWriteNumber(params.conversionRate, 'Conversion Rate'),
        conversionRateType: optionalWriteString(params.conversionRateType),
        conversionDate: optionalWriteString(params.conversionDate),
        maturityDate: optionalWriteString(params.maturityDate),
        structuredPaymentReference: optionalWriteString(params.structuredPaymentReference),
      }
    case 'oracle_fusion_financials_update_receivables_receipt':
      return {
        amount: optionalWriteNumber(params.amount, 'Amount'),
        currency: optionalWriteString(params.currency),
        receiptDate: optionalWriteString(params.receiptDate),
        receiptMethod: optionalWriteString(params.receiptMethod),
        receiptNumber: optionalWriteString(params.receiptNumber),
        accountingDate: optionalWriteString(params.accountingDate),
        customerAccountNumber: optionalWriteString(params.customerAccountNumber),
        customerName: optionalWriteString(params.customerName),
        customerSite: optionalWriteString(params.customerSite),
        comments: optionalWriteString(params.comments),
        conversionRate: optionalWriteNumber(params.conversionRate, 'Conversion Rate'),
        conversionRateType: optionalWriteString(params.conversionRateType),
        conversionDate: optionalWriteString(params.conversionDate),
        maturityDate: optionalWriteString(params.maturityDate),
        structuredPaymentReference: optionalWriteString(params.structuredPaymentReference),
      }
    case 'oracle_fusion_financials_apply_receivables_receipt':
      return {
        appliedPaymentScheduleId: optionalWriteString(params.appliedPaymentScheduleId),
        amountApplied: optionalWriteNumber(params.amountApplied, 'Amount Applied'),
        calledFrom: optionalWriteString(params.calledFrom),
      }
    case 'oracle_fusion_financials_create_expense_report':
      return {
        orgId: optionalWriteString(params.orgId),
        personId: optionalWriteString(params.personId),
        assignmentId: optionalWriteString(params.assignmentId),
        preparerId: optionalWriteString(params.preparerId),
        purpose: optionalWriteString(params.purpose),
        expenseReportNumber: optionalWriteString(params.expenseReportNumber),
        expenseReportDate: optionalWriteString(params.expenseReportDate),
        reimbursementCurrencyCode: optionalWriteString(params.reimbursementCurrencyCode),
        exchangeRateType: optionalWriteString(params.exchangeRateType),
        paymentMethodCode: optionalWriteString(params.paymentMethodCode),
        overrideApproverId: optionalWriteString(params.overrideApproverId),
        unappliedAdvancesJust: optionalWriteString(params.unappliedAdvancesJust),
        unappliedCashAdvReason: optionalWriteString(params.unappliedCashAdvReason),
      }
    case 'oracle_fusion_financials_update_expense_report':
      return {
        orgId: optionalWriteString(params.orgId),
        purpose: optionalWriteString(params.purpose),
        expenseReportDate: optionalWriteString(params.expenseReportDate),
        reimbursementCurrencyCode: optionalWriteString(params.reimbursementCurrencyCode),
        exchangeRateType: optionalWriteString(params.exchangeRateType),
        paymentMethodCode: optionalWriteString(params.paymentMethodCode),
        overrideApproverId: optionalWriteString(params.overrideApproverId),
        unappliedAdvancesJust: optionalWriteString(params.unappliedAdvancesJust),
        unappliedCashAdvReason: optionalWriteString(params.unappliedCashAdvReason),
      }
    case 'oracle_fusion_financials_remove_expense_report_cash_advance':
      return {
        cashAdvanceNumber: optionalWriteString(params.cashAdvanceNumber),
      }
    case 'oracle_fusion_financials_create_expense_line':
      return {
        assignmentId: optionalWriteString(params.assignmentId),
        orgId: optionalWriteString(params.orgId),
        personId: optionalWriteString(params.personId),
        ticketClass: optionalWriteString(params.ticketClass),
        expenseTypeId: optionalWriteString(params.expenseTypeId),
        expenseTemplateId: optionalWriteString(params.expenseTemplateId),
        description: optionalWriteString(params.description),
        justification: optionalWriteString(params.justification),
        receiptAmount: optionalWriteNumber(params.receiptAmount, 'Receipt Amount'),
        receiptCurrencyCode: optionalWriteString(params.receiptCurrencyCode),
        receiptDate: optionalWriteString(params.receiptDate),
        merchantName: optionalWriteString(params.merchantName),
        startDate: optionalWriteString(params.startDate),
        endDate: optionalWriteString(params.endDate),
        exchangeRate: optionalWriteNumber(params.exchangeRate, 'Exchange Rate'),
        reimbursementCurrencyCode: optionalWriteString(params.reimbursementCurrencyCode),
        itemizationParentExpenseId: optionalWriteString(params.itemizationParentExpenseId),
        receiptMissingFlag: optionalWriteBoolean(params.receiptMissingFlag),
        location: optionalWriteString(params.location),
        countryCode: optionalWriteString(params.countryCode),
        expenseCategoryCode: optionalWriteString(params.expenseCategoryCode),
        expenseSource: optionalWriteString(params.expenseSource),
        numberOfDays: optionalWriteNumber(params.numberOfDays, 'Number Of Days'),
        numberOfAttendees: optionalWriteNumber(params.numberOfAttendees, 'Number Of Attendees'),
        tripDistance: optionalWriteNumber(params.tripDistance, 'Trip Distance'),
        distanceUnitCode: optionalWriteString(params.distanceUnitCode),
        ticketClassCode: optionalWriteString(params.ticketClassCode),
        ticketNumber: optionalWriteString(params.ticketNumber),
      }
    case 'oracle_fusion_financials_update_expense_line':
      return {
        assignmentId: optionalWriteString(params.assignmentId),
        orgId: optionalWriteString(params.orgId),
        personId: optionalWriteString(params.personId),
        ticketClass: optionalWriteString(params.ticketClass),
        expenseTypeId: optionalWriteString(params.expenseTypeId),
        expenseTemplateId: optionalWriteString(params.expenseTemplateId),
        description: optionalWriteString(params.description),
        justification: optionalWriteString(params.justification),
        receiptAmount: optionalWriteNumber(params.receiptAmount, 'Receipt Amount'),
        receiptCurrencyCode: optionalWriteString(params.receiptCurrencyCode),
        receiptDate: optionalWriteString(params.receiptDate),
        merchantName: optionalWriteString(params.merchantName),
        startDate: optionalWriteString(params.startDate),
        endDate: optionalWriteString(params.endDate),
        exchangeRate: optionalWriteNumber(params.exchangeRate, 'Exchange Rate'),
        reimbursementCurrencyCode: optionalWriteString(params.reimbursementCurrencyCode),
        itemizationParentExpenseId: optionalWriteString(params.itemizationParentExpenseId),
        receiptMissingFlag: optionalWriteBoolean(params.receiptMissingFlag),
        location: optionalWriteString(params.location),
        countryCode: optionalWriteString(params.countryCode),
        expenseCategoryCode: optionalWriteString(params.expenseCategoryCode),
        expenseSource: optionalWriteString(params.expenseSource),
        numberOfDays: optionalWriteNumber(params.numberOfDays, 'Number Of Days'),
        numberOfAttendees: optionalWriteNumber(params.numberOfAttendees, 'Number Of Attendees'),
        tripDistance: optionalWriteNumber(params.tripDistance, 'Trip Distance'),
        distanceUnitCode: optionalWriteString(params.distanceUnitCode),
        ticketClassCode: optionalWriteString(params.ticketClassCode),
        ticketNumber: optionalWriteString(params.ticketNumber),
      }
    case 'oracle_fusion_financials_create_expense_distribution':
      return {
        expenseId: optionalWriteString(params.expenseId),
        orgId: optionalWriteString(params.orgId),
        codeCombinationId: optionalWriteString(params.codeCombinationId),
        company: optionalWriteString(params.company),
        costCenter: optionalWriteString(params.costCenter),
        reimbursableAmount: optionalWriteNumber(params.reimbursableAmount, 'Reimbursable Amount'),
      }
    case 'oracle_fusion_financials_update_expense_distribution':
      return {
        expenseId: optionalWriteString(params.expenseId),
        orgId: optionalWriteString(params.orgId),
        codeCombinationId: optionalWriteString(params.codeCombinationId),
        company: optionalWriteString(params.company),
        costCenter: optionalWriteString(params.costCenter),
        reimbursableAmount: optionalWriteNumber(params.reimbursableAmount, 'Reimbursable Amount'),
      }
    case 'oracle_fusion_financials_create_expense_itemization':
      return {
        assignmentId: optionalWriteString(params.assignmentId),
        orgId: optionalWriteString(params.orgId),
        personId: optionalWriteString(params.personId),
        expenseTypeId: optionalWriteString(params.expenseTypeId),
        expenseTemplateId: optionalWriteString(params.expenseTemplateId),
        itemizationParentExpenseId: optionalWriteString(params.itemizationParentExpenseId),
        description: optionalWriteString(params.description),
        justification: optionalWriteString(params.justification),
        receiptAmount: optionalWriteNumber(params.receiptAmount, 'Receipt Amount'),
        receiptCurrencyCode: optionalWriteString(params.receiptCurrencyCode),
        receiptDate: optionalWriteString(params.receiptDate),
        merchantName: optionalWriteString(params.merchantName),
        startDate: optionalWriteString(params.startDate),
        endDate: optionalWriteString(params.endDate),
        exchangeRate: optionalWriteNumber(params.exchangeRate, 'Exchange Rate'),
        reimbursementCurrencyCode: optionalWriteString(params.reimbursementCurrencyCode),
        receiptMissingFlag: optionalWriteBoolean(params.receiptMissingFlag),
        location: optionalWriteString(params.location),
        expenseCategoryCode: optionalWriteString(params.expenseCategoryCode),
        numberOfDays: optionalWriteNumber(params.numberOfDays, 'Number Of Days'),
        numberOfAttendees: optionalWriteNumber(params.numberOfAttendees, 'Number Of Attendees'),
      }
    case 'oracle_fusion_financials_update_expense_itemization':
      return {
        assignmentId: optionalWriteString(params.assignmentId),
        orgId: optionalWriteString(params.orgId),
        personId: optionalWriteString(params.personId),
        expenseTypeId: optionalWriteString(params.expenseTypeId),
        expenseTemplateId: optionalWriteString(params.expenseTemplateId),
        itemizationParentExpenseId: optionalWriteString(params.itemizationParentExpenseId),
        description: optionalWriteString(params.description),
        justification: optionalWriteString(params.justification),
        receiptAmount: optionalWriteNumber(params.receiptAmount, 'Receipt Amount'),
        receiptCurrencyCode: optionalWriteString(params.receiptCurrencyCode),
        receiptDate: optionalWriteString(params.receiptDate),
        merchantName: optionalWriteString(params.merchantName),
        startDate: optionalWriteString(params.startDate),
        endDate: optionalWriteString(params.endDate),
        exchangeRate: optionalWriteNumber(params.exchangeRate, 'Exchange Rate'),
        reimbursementCurrencyCode: optionalWriteString(params.reimbursementCurrencyCode),
        receiptMissingFlag: optionalWriteBoolean(params.receiptMissingFlag),
        location: optionalWriteString(params.location),
        expenseCategoryCode: optionalWriteString(params.expenseCategoryCode),
        numberOfDays: optionalWriteNumber(params.numberOfDays, 'Number Of Days'),
        numberOfAttendees: optionalWriteNumber(params.numberOfAttendees, 'Number Of Attendees'),
      }
    default:
      return {}
  }
}

export const OracleFusionFinancialsBlock: BlockConfig = {
  type: 'oracle_fusion_financials',
  name: 'Oracle Fusion Cloud Financials',
  description: 'Read Payables, manage Receivables and Expenses, and inspect General Ledger',
  longDescription:
    'Connect a reusable Oracle Fusion Cloud Financials service account with a Fusion application URL, username, and password for Basic authentication. Read bounded pages and individual Payables invoices, lines, distributions, installments, prepayments, holds, payments, paid invoices, payment process requests, and payment terms with fixed projections. Manage Receivables transactions and employee expense reports using supported writes and named lifecycle actions. Inspect ledgers, journals, and balances, and delete eligible journal batches; journal posting and import are not supported. Payables remains read-only. Permissions and business-unit or employee access are controlled by Oracle; no arbitrary REST operations or credentials are exposed.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_fusion_financials',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  authMode: AuthMode.ApiKey,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle Fusion Cloud Financials',
    sentences: {
      byOperation: {
        oracle_fusion_financials_list_receivables_invoices: [
          'List Receivables Invoices',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_invoice: [
          'Get Receivables Invoice',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_create_receivables_invoice: ['Create Receivables Invoice'],
        oracle_fusion_financials_update_receivables_invoice: [
          'Update Receivables Invoice',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_delete_receivables_invoice: [
          'Delete Receivables Invoice',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_approve_receivables_invoice: [
          'Approve Receivables Invoice',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_rework_receivables_invoice: [
          'Rework Receivables Invoice',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_receivables_invoice_lines: [
          'List Receivables Invoice Lines',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_invoice_line: [
          'Get Receivables Invoice Line',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
          {
            text: 'with Receivables Invoice Line Id',
            field: 'receivablesInvoiceLineId',
            core: true,
          },
        ],
        oracle_fusion_financials_create_receivables_invoice_line: [
          'Create Receivables Invoice Line',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_receivables_invoice_distributions: [
          'List Receivables Invoice Distributions',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_invoice_distribution: [
          'Get Receivables Invoice Distribution',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
          {
            text: 'with Receivables Invoice Distribution Id',
            field: 'receivablesInvoiceDistributionId',
            core: true,
          },
        ],
        oracle_fusion_financials_create_receivables_invoice_distribution: [
          'Create Receivables Invoice Distribution',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_receivables_invoice_installments: [
          'List Receivables Invoice Installments',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_invoice_installment: [
          'Get Receivables Invoice Installment',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
          {
            text: 'with Receivables Invoice Installment Id',
            field: 'receivablesInvoiceInstallmentId',
            core: true,
          },
        ],
        oracle_fusion_financials_update_receivables_invoice_installment: [
          'Update Receivables Invoice Installment',
          {
            text: 'with Receivables Invoice Id',
            field: ['receivablesInvoiceIdSelector', 'receivablesInvoiceIdManual'],
            core: true,
          },
          {
            text: 'with Receivables Invoice Installment Id',
            field: 'receivablesInvoiceInstallmentId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_receivables_credit_memos: [
          'List Receivables Credit Memos',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_credit_memo: [
          'Get Receivables Credit Memo',
          {
            text: 'with Receivables Credit Memo Id',
            field: ['receivablesCreditMemoIdSelector', 'receivablesCreditMemoIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_create_receivables_credit_memo: ['Create Receivables Credit Memo'],
        oracle_fusion_financials_update_receivables_credit_memo: [
          'Update Receivables Credit Memo',
          {
            text: 'with Receivables Credit Memo Id',
            field: ['receivablesCreditMemoIdSelector', 'receivablesCreditMemoIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_approve_receivables_credit_memo: [
          'Approve Receivables Credit Memo',
          {
            text: 'with Receivables Credit Memo Id',
            field: ['receivablesCreditMemoIdSelector', 'receivablesCreditMemoIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_rework_receivables_credit_memo: [
          'Rework Receivables Credit Memo',
          {
            text: 'with Receivables Credit Memo Id',
            field: ['receivablesCreditMemoIdSelector', 'receivablesCreditMemoIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_receivables_credit_memo_lines: [
          'List Receivables Credit Memo Lines',
          {
            text: 'with Receivables Credit Memo Id',
            field: ['receivablesCreditMemoIdSelector', 'receivablesCreditMemoIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_credit_memo_line: [
          'Get Receivables Credit Memo Line',
          {
            text: 'with Receivables Credit Memo Id',
            field: ['receivablesCreditMemoIdSelector', 'receivablesCreditMemoIdManual'],
            core: true,
          },
          {
            text: 'with Receivables Credit Memo Line Id',
            field: 'receivablesCreditMemoLineId',
            core: true,
          },
        ],
        oracle_fusion_financials_create_receivables_credit_memo_line: [
          'Create Receivables Credit Memo Line',
          {
            text: 'with Receivables Credit Memo Id',
            field: ['receivablesCreditMemoIdSelector', 'receivablesCreditMemoIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_receivables_credit_memo_distributions: [
          'List Receivables Credit Memo Distributions',
          {
            text: 'with Receivables Credit Memo Id',
            field: ['receivablesCreditMemoIdSelector', 'receivablesCreditMemoIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_credit_memo_distribution: [
          'Get Receivables Credit Memo Distribution',
          {
            text: 'with Receivables Credit Memo Id',
            field: ['receivablesCreditMemoIdSelector', 'receivablesCreditMemoIdManual'],
            core: true,
          },
          {
            text: 'with Receivables Credit Memo Distribution Id',
            field: 'receivablesCreditMemoDistributionId',
            core: true,
          },
        ],
        oracle_fusion_financials_create_receivables_credit_memo_distribution: [
          'Create Receivables Credit Memo Distribution',
          {
            text: 'with Receivables Credit Memo Id',
            field: ['receivablesCreditMemoIdSelector', 'receivablesCreditMemoIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_receivables_receipts: [
          'List Receivables Receipts',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_receipt: [
          'Get Receivables Receipt',
          {
            text: 'with Receivables Receipt Id',
            field: ['receivablesReceiptIdSelector', 'receivablesReceiptIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_create_receivables_receipt: ['Create Receivables Receipt'],
        oracle_fusion_financials_update_receivables_receipt: [
          'Update Receivables Receipt',
          {
            text: 'with Receivables Receipt Id',
            field: ['receivablesReceiptIdSelector', 'receivablesReceiptIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_delete_receivables_receipt: [
          'Delete Receivables Receipt',
          {
            text: 'with Receivables Receipt Id',
            field: ['receivablesReceiptIdSelector', 'receivablesReceiptIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_apply_receivables_receipt: [
          'Apply Receivables Receipt',
          {
            text: 'with Receivables Receipt Id',
            field: ['receivablesReceiptIdSelector', 'receivablesReceiptIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_receivables_customer_accounts: [
          'List Receivables Customer Accounts',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_customer_account: [
          'Get Receivables Customer Account',
          {
            text: 'with Receivables Customer Account Id',
            field: ['receivablesCustomerAccountIdSelector', 'receivablesCustomerAccountIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_receivables_customer_account_sites: [
          'List Receivables Customer Account Sites',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_customer_account_site: [
          'Get Receivables Customer Account Site',
          {
            text: 'with Receivables Customer Account Site Id',
            field: [
              'receivablesCustomerAccountSiteIdSelector',
              'receivablesCustomerAccountSiteIdManual',
            ],
            core: true,
          },
        ],
        oracle_fusion_financials_list_receivables_receipt_applications: [
          'List Receivables Receipt Applications',
          {
            text: 'with Receivables Customer Account Id',
            field: ['receivablesCustomerAccountIdSelector', 'receivablesCustomerAccountIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_receipt_application: [
          'Get Receivables Receipt Application',
          {
            text: 'with Receivables Customer Account Id',
            field: ['receivablesCustomerAccountIdSelector', 'receivablesCustomerAccountIdManual'],
            core: true,
          },
          {
            text: 'with Receivables Receipt Application Id',
            field: 'receivablesReceiptApplicationId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_receivables_credit_memo_applications: [
          'List Receivables Credit Memo Applications',
          {
            text: 'with Receivables Customer Account Id',
            field: ['receivablesCustomerAccountIdSelector', 'receivablesCustomerAccountIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_credit_memo_application: [
          'Get Receivables Credit Memo Application',
          {
            text: 'with Receivables Customer Account Id',
            field: ['receivablesCustomerAccountIdSelector', 'receivablesCustomerAccountIdManual'],
            core: true,
          },
          {
            text: 'with Receivables Credit Memo Application Id',
            field: 'receivablesCreditMemoApplicationId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_receivables_transaction_payment_schedules: [
          'List Receivables Transaction Payment Schedules',
          {
            text: 'with Receivables Customer Account Id',
            field: ['receivablesCustomerAccountIdSelector', 'receivablesCustomerAccountIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_transaction_payment_schedule: [
          'Get Receivables Transaction Payment Schedule',
          {
            text: 'with Receivables Customer Account Id',
            field: ['receivablesCustomerAccountIdSelector', 'receivablesCustomerAccountIdManual'],
            core: true,
          },
          {
            text: 'with Receivables Transaction Payment Schedule Id',
            field: 'receivablesTransactionPaymentScheduleId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_receivables_transaction_adjustments: [
          'List Receivables Transaction Adjustments',
          {
            text: 'with Receivables Customer Account Id',
            field: ['receivablesCustomerAccountIdSelector', 'receivablesCustomerAccountIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_receivables_transaction_adjustment: [
          'Get Receivables Transaction Adjustment',
          {
            text: 'with Receivables Customer Account Id',
            field: ['receivablesCustomerAccountIdSelector', 'receivablesCustomerAccountIdManual'],
            core: true,
          },
          {
            text: 'with Receivables Transaction Adjustment Id',
            field: 'receivablesTransactionAdjustmentId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_expense_reports: [
          'List Expense Reports',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_expense_report: [
          'Get Expense Report',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_create_expense_report: ['Create Expense Report'],
        oracle_fusion_financials_update_expense_report: [
          'Update Expense Report',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_submit_expense_report: [
          'Submit Expense Report',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_remove_expense_report_cash_advance: [
          'Remove Expense Report Cash Advance',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_expense_lines: [
          'List Expense Lines',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_expense_line: [
          'Get Expense Line',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Line Uniq Id',
            field: 'expenseLineUniqId',
            core: true,
          },
        ],
        oracle_fusion_financials_create_expense_line: [
          'Create Expense Line',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_update_expense_line: [
          'Update Expense Line',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Line Uniq Id',
            field: 'expenseLineUniqId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_expense_distributions: [
          'List Expense Distributions',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Line Uniq Id',
            field: 'expenseLineUniqId',
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_expense_distribution: [
          'Get Expense Distribution',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Line Uniq Id',
            field: 'expenseLineUniqId',
            core: true,
          },
          {
            text: 'with Expense Distribution Id',
            field: 'expenseDistributionId',
            core: true,
          },
        ],
        oracle_fusion_financials_create_expense_distribution: [
          'Create Expense Distribution',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Line Uniq Id',
            field: 'expenseLineUniqId',
            core: true,
          },
        ],
        oracle_fusion_financials_update_expense_distribution: [
          'Update Expense Distribution',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Line Uniq Id',
            field: 'expenseLineUniqId',
            core: true,
          },
          {
            text: 'with Expense Distribution Id',
            field: 'expenseDistributionId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_expense_itemizations: [
          'List Expense Itemizations',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Line Uniq Id',
            field: 'expenseLineUniqId',
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_expense_itemization: [
          'Get Expense Itemization',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Line Uniq Id',
            field: 'expenseLineUniqId',
            core: true,
          },
          {
            text: 'with Expense Itemization Id',
            field: 'expenseItemizationId',
            core: true,
          },
        ],
        oracle_fusion_financials_create_expense_itemization: [
          'Create Expense Itemization',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Line Uniq Id',
            field: 'expenseLineUniqId',
            core: true,
          },
        ],
        oracle_fusion_financials_update_expense_itemization: [
          'Update Expense Itemization',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Line Uniq Id',
            field: 'expenseLineUniqId',
            core: true,
          },
          {
            text: 'with Expense Itemization Id',
            field: 'expenseItemizationId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_expense_report_processing_details: [
          'List Expense Report Processing Details',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_expense_report_processing_detail: [
          'Get Expense Report Processing Detail',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Report Processing Detail Uniq Id',
            field: 'expenseReportProcessingDetailUniqId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_expense_report_payments: [
          'List Expense Report Payments',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_expense_report_payment: [
          'Get Expense Report Payment',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Report Payment Id',
            field: 'expenseReportPaymentId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_expense_line_errors: [
          'List Expense Line Errors',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Line Uniq Id',
            field: 'expenseLineUniqId',
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_expense_line_error: [
          'Get Expense Line Error',
          {
            text: 'with Expense Report Uniq Id',
            field: ['expenseReportUniqIdSelector', 'expenseReportUniqIdManual'],
            core: true,
          },
          {
            text: 'with Expense Line Uniq Id',
            field: 'expenseLineUniqId',
            core: true,
          },
          {
            text: 'with Expense Line Error Sequence',
            field: 'expenseLineErrorSequence',
            core: true,
          },
        ],
        oracle_fusion_financials_list_gl_ledgers: [
          'List Gl Ledgers',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_gl_ledger: [
          'Get Gl Ledger',
          {
            text: 'with Gl Ledger Id',
            field: ['glLedgerIdSelector', 'glLedgerIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_gl_journal_batches: [
          'List Gl Journal Batches',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_gl_journal_batch: [
          'Get Gl Journal Batch',
          {
            text: 'with Gl Journal Batch Id',
            field: ['glJournalBatchIdSelector', 'glJournalBatchIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_delete_gl_journal_batch: [
          'Delete Gl Journal Batch',
          {
            text: 'with Gl Journal Batch Id',
            field: ['glJournalBatchIdSelector', 'glJournalBatchIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_gl_journal_headers: [
          'List Gl Journal Headers',
          {
            text: 'with Gl Journal Batch Id',
            field: ['glJournalBatchIdSelector', 'glJournalBatchIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_gl_journal_header: [
          'Get Gl Journal Header',
          {
            text: 'with Gl Journal Batch Id',
            field: ['glJournalBatchIdSelector', 'glJournalBatchIdManual'],
            core: true,
          },
          {
            text: 'with Gl Journal Header Uniq Id',
            field: 'glJournalHeaderUniqId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_gl_journal_lines: [
          'List Gl Journal Lines',
          {
            text: 'with Gl Journal Batch Id',
            field: ['glJournalBatchIdSelector', 'glJournalBatchIdManual'],
            core: true,
          },
          {
            text: 'with Gl Journal Header Uniq Id',
            field: 'glJournalHeaderUniqId',
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_gl_journal_line: [
          'Get Gl Journal Line',
          {
            text: 'with Gl Journal Batch Id',
            field: ['glJournalBatchIdSelector', 'glJournalBatchIdManual'],
            core: true,
          },
          {
            text: 'with Gl Journal Header Uniq Id',
            field: 'glJournalHeaderUniqId',
            core: true,
          },
          {
            text: 'with Gl Journal Line Uniq Id',
            field: 'glJournalLineUniqId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_gl_journal_errors: [
          'List Gl Journal Errors',
          {
            text: 'with Gl Journal Batch Id',
            field: ['glJournalBatchIdSelector', 'glJournalBatchIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_gl_journal_error: [
          'Get Gl Journal Error',
          {
            text: 'with Gl Journal Batch Id',
            field: ['glJournalBatchIdSelector', 'glJournalBatchIdManual'],
            core: true,
          },
          {
            text: 'with Gl Journal Error Uniq Id',
            field: 'glJournalErrorUniqId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_gl_journal_action_logs: [
          'List Gl Journal Action Logs',
          {
            text: 'with Gl Journal Batch Id',
            field: ['glJournalBatchIdSelector', 'glJournalBatchIdManual'],
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_gl_journal_action_log: [
          'Get Gl Journal Action Log',
          {
            text: 'with Gl Journal Batch Id',
            field: ['glJournalBatchIdSelector', 'glJournalBatchIdManual'],
            core: true,
          },
          {
            text: 'with Gl Journal Action Log Uniq Id',
            field: 'glJournalActionLogUniqId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_gl_balances: [
          'List Gl Balances',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_list_payables_invoices: [
          'List Payables invoices',
          { text: ', matching', field: 'q' },
          { text: ', ordered by', field: 'orderBy' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_payables_invoice: [
          {
            text: 'Read Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_invoice_lines: [
          {
            text: 'List lines for Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'lines' },
        ],
        oracle_fusion_financials_get_payables_invoice_line: [
          {
            text: 'Read line',
            field: 'invoiceLineUniqId',
            core: true,
          },
          {
            text: 'from Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_invoice_installments: [
          {
            text: 'List installments for Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'installments' },
        ],
        oracle_fusion_financials_get_payables_invoice_installment: [
          {
            text: 'Read installment',
            field: 'invoiceInstallmentUniqId',
            core: true,
          },
          {
            text: 'from Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_invoice_distributions: [
          {
            text: 'List distributions for line',
            field: 'invoiceLineUniqId',
            core: true,
          },
          {
            text: 'of Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
          { text: ', matching', field: 'q' },
        ],
        oracle_fusion_financials_get_payables_invoice_distribution: [
          {
            text: 'Read distribution',
            field: 'invoiceDistributionId',
            core: true,
          },
          { text: 'for line', field: 'invoiceLineUniqId', core: true },
          {
            text: 'of Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_applied_prepayments: [
          {
            text: 'List applied prepayments for Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
          { text: ', matching', field: 'q' },
        ],
        oracle_fusion_financials_get_payables_applied_prepayment: [
          {
            text: 'Read applied prepayment',
            field: 'appliedPrepaymentUniqId',
            core: true,
          },
          {
            text: 'for Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_available_prepayments: [
          {
            text: 'List available prepayments for Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
          { text: ', matching', field: 'q' },
        ],
        oracle_fusion_financials_get_payables_available_prepayment: [
          {
            text: 'Read available prepayment',
            field: 'availablePrepaymentUniqId',
            core: true,
          },
          {
            text: 'for Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_payments: [
          'List Payables payments',
          { text: ', matching', field: 'q' },
          { text: ', ordered by', field: 'orderBy' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_payables_payment: [
          { text: 'Read Payables payment', field: 'checkId', core: true },
        ],
        oracle_fusion_financials_list_payables_payment_related_invoices: [
          { text: 'List invoices paid by payment', field: 'checkId', core: true },
          { text: ', matching', field: 'q' },
        ],
        oracle_fusion_financials_get_payables_payment_related_invoice: [
          { text: 'Read paid invoice', field: 'invoicePaymentId', core: true },
          { text: 'for payment', field: 'checkId', core: true },
        ],
        oracle_fusion_financials_list_payment_process_requests: [
          'List payment process requests',
          { text: ', matching', field: 'q' },
          { text: ', ordered by', field: 'orderBy' },
        ],
        oracle_fusion_financials_get_payment_process_request: [
          {
            text: 'Read payment process request',
            field: 'paymentProcessRequestId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_invoice_holds: [
          'List Payables invoice holds',
          { text: ', matching', field: 'q' },
          { text: ', ordered by', field: 'orderBy' },
        ],
        oracle_fusion_financials_get_payables_invoice_hold: [
          { text: 'Read Payables invoice hold', field: 'holdId', core: true },
        ],
        oracle_fusion_financials_list_payables_payment_terms: [
          'List Payables payment terms',
          { text: ', matching', field: 'q' },
          { text: ', ordered by', field: 'orderBy' },
        ],
        oracle_fusion_financials_get_payables_payment_term: [
          { text: 'Read Payables payment term', field: 'termsId', core: true },
        ],
        oracle_fusion_financials_list_payables_payment_term_lines: [
          { text: 'List calculation lines for payment term', field: 'termsId', core: true },
          { text: ', matching', field: 'q' },
        ],
        oracle_fusion_financials_get_payables_payment_term_line: [
          {
            text: 'Read calculation line',
            field: 'paymentTermLineUniqId',
            core: true,
          },
          { text: 'for payment term', field: 'termsId', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'Oracle Fusion Account',
      type: 'oauth-input',
      serviceId: 'oracle_fusion_financials',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Oracle Fusion credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Oracle Fusion Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        {
          label: 'List Payables Invoices',
          id: 'oracle_fusion_financials_list_payables_invoices',
        },
        {
          label: 'Get Payables Invoice',
          id: 'oracle_fusion_financials_get_payables_invoice',
        },
        {
          label: 'List Payables Invoice Lines',
          id: 'oracle_fusion_financials_list_payables_invoice_lines',
        },
        {
          label: 'Get Payables Invoice Line',
          id: 'oracle_fusion_financials_get_payables_invoice_line',
        },
        {
          label: 'List Payables Invoice Installments',
          id: 'oracle_fusion_financials_list_payables_invoice_installments',
        },
        {
          label: 'Get Payables Invoice Installment',
          id: 'oracle_fusion_financials_get_payables_invoice_installment',
        },
        {
          label: 'List Payables Invoice Distributions',
          id: 'oracle_fusion_financials_list_payables_invoice_distributions',
        },
        {
          label: 'Get Payables Invoice Distribution',
          id: 'oracle_fusion_financials_get_payables_invoice_distribution',
        },
        {
          label: 'List Payables Applied Prepayments',
          id: 'oracle_fusion_financials_list_payables_applied_prepayments',
        },
        {
          label: 'Get Payables Applied Prepayment',
          id: 'oracle_fusion_financials_get_payables_applied_prepayment',
        },
        {
          label: 'List Payables Available Prepayments',
          id: 'oracle_fusion_financials_list_payables_available_prepayments',
        },
        {
          label: 'Get Payables Available Prepayment',
          id: 'oracle_fusion_financials_get_payables_available_prepayment',
        },
        {
          label: 'List Payables Payments',
          id: 'oracle_fusion_financials_list_payables_payments',
        },
        {
          label: 'Get Payables Payment',
          id: 'oracle_fusion_financials_get_payables_payment',
        },
        {
          label: 'List Payment-Related Invoices',
          id: 'oracle_fusion_financials_list_payables_payment_related_invoices',
        },
        {
          label: 'Get Payment-Related Invoice',
          id: 'oracle_fusion_financials_get_payables_payment_related_invoice',
        },
        {
          label: 'List Payment Process Requests',
          id: 'oracle_fusion_financials_list_payment_process_requests',
        },
        {
          label: 'Get Payment Process Request',
          id: 'oracle_fusion_financials_get_payment_process_request',
        },
        {
          label: 'List Payables Invoice Holds',
          id: 'oracle_fusion_financials_list_payables_invoice_holds',
        },
        {
          label: 'Get Payables Invoice Hold',
          id: 'oracle_fusion_financials_get_payables_invoice_hold',
        },
        {
          label: 'List Payables Payment Terms',
          id: 'oracle_fusion_financials_list_payables_payment_terms',
        },
        {
          label: 'Get Payables Payment Term',
          id: 'oracle_fusion_financials_get_payables_payment_term',
        },
        {
          label: 'List Payables Payment Term Lines',
          id: 'oracle_fusion_financials_list_payables_payment_term_lines',
        },
        {
          label: 'Get Payables Payment Term Line',
          id: 'oracle_fusion_financials_get_payables_payment_term_line',
        },
        {
          label: 'Receivables · List Invoices',
          id: 'oracle_fusion_financials_list_receivables_invoices',
        },
        {
          label: 'Receivables · Get Invoice',
          id: 'oracle_fusion_financials_get_receivables_invoice',
        },
        {
          label: 'Receivables · Create Invoice',
          id: 'oracle_fusion_financials_create_receivables_invoice',
        },
        {
          label: 'Receivables · Update Invoice',
          id: 'oracle_fusion_financials_update_receivables_invoice',
        },
        {
          label: 'Receivables · Delete Invoice',
          id: 'oracle_fusion_financials_delete_receivables_invoice',
        },
        {
          label: 'Receivables · Approve Invoice',
          id: 'oracle_fusion_financials_approve_receivables_invoice',
        },
        {
          label: 'Receivables · Rework Invoice',
          id: 'oracle_fusion_financials_rework_receivables_invoice',
        },
        {
          label: 'Receivables · List Invoice Lines',
          id: 'oracle_fusion_financials_list_receivables_invoice_lines',
        },
        {
          label: 'Receivables · Get Invoice Line',
          id: 'oracle_fusion_financials_get_receivables_invoice_line',
        },
        {
          label: 'Receivables · Create Invoice Line',
          id: 'oracle_fusion_financials_create_receivables_invoice_line',
        },
        {
          label: 'Receivables · List Invoice Distributions',
          id: 'oracle_fusion_financials_list_receivables_invoice_distributions',
        },
        {
          label: 'Receivables · Get Invoice Distribution',
          id: 'oracle_fusion_financials_get_receivables_invoice_distribution',
        },
        {
          label: 'Receivables · Create Invoice Distribution',
          id: 'oracle_fusion_financials_create_receivables_invoice_distribution',
        },
        {
          label: 'Receivables · List Invoice Installments',
          id: 'oracle_fusion_financials_list_receivables_invoice_installments',
        },
        {
          label: 'Receivables · Get Invoice Installment',
          id: 'oracle_fusion_financials_get_receivables_invoice_installment',
        },
        {
          label: 'Receivables · Update Invoice Installment',
          id: 'oracle_fusion_financials_update_receivables_invoice_installment',
        },
        {
          label: 'Receivables · List Credit Memos',
          id: 'oracle_fusion_financials_list_receivables_credit_memos',
        },
        {
          label: 'Receivables · Get Credit Memo',
          id: 'oracle_fusion_financials_get_receivables_credit_memo',
        },
        {
          label: 'Receivables · Create Credit Memo',
          id: 'oracle_fusion_financials_create_receivables_credit_memo',
        },
        {
          label: 'Receivables · Update Credit Memo',
          id: 'oracle_fusion_financials_update_receivables_credit_memo',
        },
        {
          label: 'Receivables · Approve Credit Memo',
          id: 'oracle_fusion_financials_approve_receivables_credit_memo',
        },
        {
          label: 'Receivables · Rework Credit Memo',
          id: 'oracle_fusion_financials_rework_receivables_credit_memo',
        },
        {
          label: 'Receivables · List Credit Memo Lines',
          id: 'oracle_fusion_financials_list_receivables_credit_memo_lines',
        },
        {
          label: 'Receivables · Get Credit Memo Line',
          id: 'oracle_fusion_financials_get_receivables_credit_memo_line',
        },
        {
          label: 'Receivables · Create Credit Memo Line',
          id: 'oracle_fusion_financials_create_receivables_credit_memo_line',
        },
        {
          label: 'Receivables · List Credit Memo Distributions',
          id: 'oracle_fusion_financials_list_receivables_credit_memo_distributions',
        },
        {
          label: 'Receivables · Get Credit Memo Distribution',
          id: 'oracle_fusion_financials_get_receivables_credit_memo_distribution',
        },
        {
          label: 'Receivables · Create Credit Memo Distribution',
          id: 'oracle_fusion_financials_create_receivables_credit_memo_distribution',
        },
        {
          label: 'Receivables · List Receipts',
          id: 'oracle_fusion_financials_list_receivables_receipts',
        },
        {
          label: 'Receivables · Get Receipt',
          id: 'oracle_fusion_financials_get_receivables_receipt',
        },
        {
          label: 'Receivables · Create Receipt',
          id: 'oracle_fusion_financials_create_receivables_receipt',
        },
        {
          label: 'Receivables · Update Receipt',
          id: 'oracle_fusion_financials_update_receivables_receipt',
        },
        {
          label: 'Receivables · Delete Receipt',
          id: 'oracle_fusion_financials_delete_receivables_receipt',
        },
        {
          label: 'Receivables · Apply Receipt',
          id: 'oracle_fusion_financials_apply_receivables_receipt',
        },
        {
          label: 'Receivables · List Customer Accounts',
          id: 'oracle_fusion_financials_list_receivables_customer_accounts',
        },
        {
          label: 'Receivables · Get Customer Account',
          id: 'oracle_fusion_financials_get_receivables_customer_account',
        },
        {
          label: 'Receivables · List Customer Account Sites',
          id: 'oracle_fusion_financials_list_receivables_customer_account_sites',
        },
        {
          label: 'Receivables · Get Customer Account Site',
          id: 'oracle_fusion_financials_get_receivables_customer_account_site',
        },
        {
          label: 'Receivables · List Receipt Applications',
          id: 'oracle_fusion_financials_list_receivables_receipt_applications',
        },
        {
          label: 'Receivables · Get Receipt Application',
          id: 'oracle_fusion_financials_get_receivables_receipt_application',
        },
        {
          label: 'Receivables · List Credit Memo Applications',
          id: 'oracle_fusion_financials_list_receivables_credit_memo_applications',
        },
        {
          label: 'Receivables · Get Credit Memo Application',
          id: 'oracle_fusion_financials_get_receivables_credit_memo_application',
        },
        {
          label: 'Receivables · List Transaction Payment Schedules',
          id: 'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
        },
        {
          label: 'Receivables · Get Transaction Payment Schedule',
          id: 'oracle_fusion_financials_get_receivables_transaction_payment_schedule',
        },
        {
          label: 'Receivables · List Transaction Adjustments',
          id: 'oracle_fusion_financials_list_receivables_transaction_adjustments',
        },
        {
          label: 'Receivables · Get Transaction Adjustment',
          id: 'oracle_fusion_financials_get_receivables_transaction_adjustment',
        },
        {
          label: 'Expenses · List Expense Reports',
          id: 'oracle_fusion_financials_list_expense_reports',
        },
        {
          label: 'Expenses · Get Expense Report',
          id: 'oracle_fusion_financials_get_expense_report',
        },
        {
          label: 'Expenses · Create Expense Report',
          id: 'oracle_fusion_financials_create_expense_report',
        },
        {
          label: 'Expenses · Update Expense Report',
          id: 'oracle_fusion_financials_update_expense_report',
        },
        {
          label: 'Expenses · Submit Expense Report',
          id: 'oracle_fusion_financials_submit_expense_report',
        },
        {
          label: 'Expenses · Remove Expense Report Cash Advance',
          id: 'oracle_fusion_financials_remove_expense_report_cash_advance',
        },
        {
          label: 'Expenses · List Expense Lines',
          id: 'oracle_fusion_financials_list_expense_lines',
        },
        {
          label: 'Expenses · Get Expense Line',
          id: 'oracle_fusion_financials_get_expense_line',
        },
        {
          label: 'Expenses · Create Expense Line',
          id: 'oracle_fusion_financials_create_expense_line',
        },
        {
          label: 'Expenses · Update Expense Line',
          id: 'oracle_fusion_financials_update_expense_line',
        },
        {
          label: 'Expenses · List Expense Distributions',
          id: 'oracle_fusion_financials_list_expense_distributions',
        },
        {
          label: 'Expenses · Get Expense Distribution',
          id: 'oracle_fusion_financials_get_expense_distribution',
        },
        {
          label: 'Expenses · Create Expense Distribution',
          id: 'oracle_fusion_financials_create_expense_distribution',
        },
        {
          label: 'Expenses · Update Expense Distribution',
          id: 'oracle_fusion_financials_update_expense_distribution',
        },
        {
          label: 'Expenses · List Expense Itemizations',
          id: 'oracle_fusion_financials_list_expense_itemizations',
        },
        {
          label: 'Expenses · Get Expense Itemization',
          id: 'oracle_fusion_financials_get_expense_itemization',
        },
        {
          label: 'Expenses · Create Expense Itemization',
          id: 'oracle_fusion_financials_create_expense_itemization',
        },
        {
          label: 'Expenses · Update Expense Itemization',
          id: 'oracle_fusion_financials_update_expense_itemization',
        },
        {
          label: 'Expenses · List Expense Report Processing Details',
          id: 'oracle_fusion_financials_list_expense_report_processing_details',
        },
        {
          label: 'Expenses · Get Expense Report Processing Detail',
          id: 'oracle_fusion_financials_get_expense_report_processing_detail',
        },
        {
          label: 'Expenses · List Expense Report Payments',
          id: 'oracle_fusion_financials_list_expense_report_payments',
        },
        {
          label: 'Expenses · Get Expense Report Payment',
          id: 'oracle_fusion_financials_get_expense_report_payment',
        },
        {
          label: 'Expenses · List Expense Line Errors',
          id: 'oracle_fusion_financials_list_expense_line_errors',
        },
        {
          label: 'Expenses · Get Expense Line Error',
          id: 'oracle_fusion_financials_get_expense_line_error',
        },
        {
          label: 'General Ledger · List Ledgers',
          id: 'oracle_fusion_financials_list_gl_ledgers',
        },
        {
          label: 'General Ledger · Get Ledger',
          id: 'oracle_fusion_financials_get_gl_ledger',
        },
        {
          label: 'General Ledger · List Journal Batches',
          id: 'oracle_fusion_financials_list_gl_journal_batches',
        },
        {
          label: 'General Ledger · Get Journal Batch',
          id: 'oracle_fusion_financials_get_gl_journal_batch',
        },
        {
          label: 'General Ledger · Delete Journal Batch',
          id: 'oracle_fusion_financials_delete_gl_journal_batch',
        },
        {
          label: 'General Ledger · List Journal Headers',
          id: 'oracle_fusion_financials_list_gl_journal_headers',
        },
        {
          label: 'General Ledger · Get Journal Header',
          id: 'oracle_fusion_financials_get_gl_journal_header',
        },
        {
          label: 'General Ledger · List Journal Lines',
          id: 'oracle_fusion_financials_list_gl_journal_lines',
        },
        {
          label: 'General Ledger · Get Journal Line',
          id: 'oracle_fusion_financials_get_gl_journal_line',
        },
        {
          label: 'General Ledger · List Journal Errors',
          id: 'oracle_fusion_financials_list_gl_journal_errors',
        },
        {
          label: 'General Ledger · Get Journal Error',
          id: 'oracle_fusion_financials_get_gl_journal_error',
        },
        {
          label: 'General Ledger · List Journal Action Logs',
          id: 'oracle_fusion_financials_list_gl_journal_action_logs',
        },
        {
          label: 'General Ledger · Get Journal Action Log',
          id: 'oracle_fusion_financials_get_gl_journal_action_log',
        },
        {
          label: 'General Ledger · List Balances',
          id: 'oracle_fusion_financials_list_gl_balances',
        },
      ],
      value: () => 'oracle_fusion_financials_list_payables_invoices',
      required: true,
    },
    {
      id: 'invoiceSelector',
      title: 'Payables Invoice',
      type: 'project-selector',
      canonicalParamId: 'invoiceUniqId',
      serviceId: 'oracle_fusion_financials',
      selectorKey: 'oracleFusionFinancials.invoices',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select a recent invoice',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_get_payables_invoice_line',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_get_payables_invoice_installment',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_get_payables_invoice_distribution',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_get_payables_applied_prepayment',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_get_payables_available_prepayment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_get_payables_invoice_line',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_get_payables_invoice_installment',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_get_payables_invoice_distribution',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_get_payables_applied_prepayment',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_get_payables_available_prepayment',
        ],
      },
    },
    {
      id: 'invoiceUniqIdManual',
      title: 'Payables Invoice Key',
      type: 'short-input',
      canonicalParamId: 'invoiceUniqId',
      mode: 'advanced',
      placeholder: 'Opaque key returned by Oracle Fusion',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_get_payables_invoice_line',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_get_payables_invoice_installment',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_get_payables_invoice_distribution',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_get_payables_applied_prepayment',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_get_payables_available_prepayment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_get_payables_invoice_line',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_get_payables_invoice_installment',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_get_payables_invoice_distribution',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_get_payables_applied_prepayment',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_get_payables_available_prepayment',
        ],
      },
    },
    {
      id: 'invoiceLineUniqId',
      title: 'Invoice Line Key',
      type: 'short-input',
      placeholder: 'Opaque invoice-line key returned by Oracle',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice_line',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_get_payables_invoice_distribution',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice_line',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_get_payables_invoice_distribution',
        ],
      },
    },
    {
      id: 'invoiceInstallmentUniqId',
      title: 'Invoice Installment Key',
      type: 'short-input',
      placeholder: 'Opaque invoice-installment key returned by Oracle',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_installment',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_installment',
      },
    },
    {
      id: 'invoiceDistributionId',
      title: 'Invoice Distribution ID',
      type: 'short-input',
      placeholder: 'Oracle InvoiceDistributionId',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_distribution',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_distribution',
      },
    },
    {
      id: 'appliedPrepaymentUniqId',
      title: 'Applied Prepayment Key',
      type: 'short-input',
      placeholder: 'Opaque applied-prepayment key returned by Oracle',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_applied_prepayment',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_applied_prepayment',
      },
    },
    {
      id: 'availablePrepaymentUniqId',
      title: 'Available Prepayment Key',
      type: 'short-input',
      placeholder: 'Opaque available-prepayment key returned by Oracle',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_available_prepayment',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_available_prepayment',
      },
    },
    {
      id: 'checkId',
      title: 'Payment Check ID',
      type: 'short-input',
      placeholder: 'Oracle payment CheckId',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_payment',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_get_payables_payment_related_invoice',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_payment',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_get_payables_payment_related_invoice',
        ],
      },
    },
    {
      id: 'invoicePaymentId',
      title: 'Invoice Payment ID',
      type: 'short-input',
      placeholder: 'Oracle InvoicePaymentId',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_payment_related_invoice',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_payment_related_invoice',
      },
    },
    {
      id: 'paymentProcessRequestId',
      title: 'Payment Process Request ID',
      type: 'short-input',
      placeholder: 'Oracle PaymentProcessRequestId',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payment_process_request',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payment_process_request',
      },
    },
    {
      id: 'holdId',
      title: 'Invoice Hold ID',
      type: 'short-input',
      placeholder: 'Oracle HoldId',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_hold',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_hold',
      },
    },
    {
      id: 'termsId',
      title: 'Payment Term ID',
      type: 'short-input',
      placeholder: 'Oracle termsId',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_payment_term',
          'oracle_fusion_financials_list_payables_payment_term_lines',
          'oracle_fusion_financials_get_payables_payment_term_line',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_payment_term',
          'oracle_fusion_financials_list_payables_payment_term_lines',
          'oracle_fusion_financials_get_payables_payment_term_line',
        ],
      },
    },
    {
      id: 'paymentTermLineUniqId',
      title: 'Payment Term Line Key',
      type: 'short-input',
      placeholder: 'Opaque payment-term-line key returned by Oracle',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_payment_term_line',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_payment_term_line',
      },
    },
    {
      id: 'receivablesInvoiceIdSelector',
      title: 'Receivables Invoice',
      type: 'project-selector',
      canonicalParamId: 'receivablesInvoiceId',
      serviceId: 'oracle_fusion_financials',
      selectorKey: 'oracleFusionFinancials.receivablesInvoices',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select receivables invoice',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_invoice',
          'oracle_fusion_financials_update_receivables_invoice',
          'oracle_fusion_financials_delete_receivables_invoice',
          'oracle_fusion_financials_approve_receivables_invoice',
          'oracle_fusion_financials_rework_receivables_invoice',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_get_receivables_invoice_line',
          'oracle_fusion_financials_create_receivables_invoice_line',
          'oracle_fusion_financials_list_receivables_invoice_distributions',
          'oracle_fusion_financials_get_receivables_invoice_distribution',
          'oracle_fusion_financials_create_receivables_invoice_distribution',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_get_receivables_invoice_installment',
          'oracle_fusion_financials_update_receivables_invoice_installment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_invoice',
          'oracle_fusion_financials_update_receivables_invoice',
          'oracle_fusion_financials_delete_receivables_invoice',
          'oracle_fusion_financials_approve_receivables_invoice',
          'oracle_fusion_financials_rework_receivables_invoice',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_get_receivables_invoice_line',
          'oracle_fusion_financials_create_receivables_invoice_line',
          'oracle_fusion_financials_list_receivables_invoice_distributions',
          'oracle_fusion_financials_get_receivables_invoice_distribution',
          'oracle_fusion_financials_create_receivables_invoice_distribution',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_get_receivables_invoice_installment',
          'oracle_fusion_financials_update_receivables_invoice_installment',
        ],
      },
    },
    {
      id: 'receivablesInvoiceIdManual',
      canonicalParamId: 'receivablesInvoiceId',
      mode: 'advanced',
      title: 'Receivables Invoice Id',
      type: 'short-input',
      placeholder: 'Receivables Invoice Id',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_invoice',
          'oracle_fusion_financials_update_receivables_invoice',
          'oracle_fusion_financials_delete_receivables_invoice',
          'oracle_fusion_financials_approve_receivables_invoice',
          'oracle_fusion_financials_rework_receivables_invoice',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_get_receivables_invoice_line',
          'oracle_fusion_financials_create_receivables_invoice_line',
          'oracle_fusion_financials_list_receivables_invoice_distributions',
          'oracle_fusion_financials_get_receivables_invoice_distribution',
          'oracle_fusion_financials_create_receivables_invoice_distribution',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_get_receivables_invoice_installment',
          'oracle_fusion_financials_update_receivables_invoice_installment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_invoice',
          'oracle_fusion_financials_update_receivables_invoice',
          'oracle_fusion_financials_delete_receivables_invoice',
          'oracle_fusion_financials_approve_receivables_invoice',
          'oracle_fusion_financials_rework_receivables_invoice',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_get_receivables_invoice_line',
          'oracle_fusion_financials_create_receivables_invoice_line',
          'oracle_fusion_financials_list_receivables_invoice_distributions',
          'oracle_fusion_financials_get_receivables_invoice_distribution',
          'oracle_fusion_financials_create_receivables_invoice_distribution',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_get_receivables_invoice_installment',
          'oracle_fusion_financials_update_receivables_invoice_installment',
        ],
      },
    },
    {
      id: 'businessUnit',
      title: 'Business Unit',
      type: 'short-input',
      placeholder: 'Business Unit',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_receipt',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_receipt',
        ],
      },
    },
    {
      id: 'transactionNumber',
      title: 'Transaction Number',
      type: 'short-input',
      placeholder: 'Transaction Number',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_credit_memo',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo'],
      },
    },
    {
      id: 'transactionDate',
      title: 'Transaction Date',
      type: 'short-input',
      placeholder: 'Transaction Date (YYYY-MM-DD)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_update_receivables_invoice',
          'oracle_fusion_financials_create_receivables_credit_memo',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo'],
      },
    },
    {
      id: 'accountingDate',
      title: 'Accounting Date',
      type: 'short-input',
      placeholder: 'Accounting Date (YYYY-MM-DD)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
    },
    {
      id: 'billToCustomerName',
      title: 'Bill To Customer Name',
      type: 'short-input',
      placeholder: 'Bill To Customer Name',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_credit_memo',
        ],
      },
    },
    {
      id: 'billToCustomerNumber',
      title: 'Bill To Customer Number',
      type: 'short-input',
      placeholder: 'Bill To Customer Number',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_credit_memo',
        ],
      },
    },
    {
      id: 'billToSite',
      title: 'Bill To Site',
      type: 'short-input',
      placeholder: 'Bill To Site',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_credit_memo',
        ],
      },
    },
    {
      id: 'invoiceCurrencyCode',
      title: 'Invoice Currency Code',
      type: 'short-input',
      placeholder: 'Invoice Currency Code',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_invoice'],
      },
    },
    {
      id: 'invoiceStatus',
      title: 'Invoice Status',
      type: 'short-input',
      placeholder: 'Invoice Status',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_update_receivables_invoice',
        ],
      },
    },
    {
      id: 'paymentTerms',
      title: 'Payment Terms',
      type: 'short-input',
      placeholder: 'Payment Terms',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_update_receivables_invoice',
        ],
      },
    },
    {
      id: 'transactionSource',
      title: 'Transaction Source',
      type: 'short-input',
      placeholder: 'Transaction Source',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_credit_memo',
        ],
      },
    },
    {
      id: 'transactionType',
      title: 'Transaction Type',
      type: 'short-input',
      placeholder: 'Transaction Type',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_update_receivables_credit_memo',
        ],
      },
    },
    {
      id: 'comments',
      title: 'Comments',
      type: 'short-input',
      placeholder: 'Comments',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_invoice_distribution',
          'oracle_fusion_financials_create_receivables_credit_memo_distribution',
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
    },
    {
      id: 'purchaseOrder',
      title: 'Purchase Order',
      type: 'short-input',
      placeholder: 'Purchase Order',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_invoice'],
      },
    },
    {
      id: 'conversionRateType',
      title: 'Conversion Rate Type',
      type: 'short-input',
      placeholder: 'Conversion Rate Type',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
    },
    {
      id: 'conversionRate',
      title: 'Conversion Rate',
      type: 'short-input',
      placeholder: 'Conversion Rate',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
    },
    {
      id: 'conversionDate',
      title: 'Conversion Date',
      type: 'short-input',
      placeholder: 'Conversion Date (YYYY-MM-DD)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
    },
    {
      id: 'lines',
      title: 'Lines',
      type: 'code',
      language: 'json',
      placeholder:
        'Typed lines to create with the receivables invoice (at most 1000). Use Oracle attribute names; exact integer attributes must be strings.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_credit_memo',
        ],
      },
    },
    {
      id: 'distributions',
      title: 'Distributions',
      type: 'code',
      language: 'json',
      placeholder:
        'Typed distributions to create with the receivables invoice (at most 1000). Use Oracle attribute names; exact integer attributes must be strings.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_credit_memo',
        ],
      },
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'short-input',
      placeholder: 'Note recorded in the approval audit history',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_approve_receivables_invoice',
          'oracle_fusion_financials_rework_receivables_invoice',
          'oracle_fusion_financials_approve_receivables_credit_memo',
          'oracle_fusion_financials_rework_receivables_credit_memo',
        ],
      },
    },
    {
      id: 'receivablesInvoiceLineId',
      title: 'Receivables Invoice Line Id',
      type: 'short-input',
      placeholder: 'Receivables Invoice Line Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_invoice_line'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_invoice_line'],
      },
    },
    {
      id: 'lineNumber',
      title: 'Line Number',
      type: 'short-input',
      placeholder: 'Line Number',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice_line',
          'oracle_fusion_financials_create_receivables_credit_memo_line',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo_line'],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Description',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice_line',
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'itemNumber',
      title: 'Item Number',
      type: 'short-input',
      placeholder: 'Item Number',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice_line',
          'oracle_fusion_financials_create_receivables_credit_memo_line',
        ],
      },
    },
    {
      id: 'memoLine',
      title: 'Memo Line',
      type: 'short-input',
      placeholder: 'Memo Line',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice_line',
          'oracle_fusion_financials_create_receivables_credit_memo_line',
        ],
      },
    },
    {
      id: 'lineAmount',
      title: 'Line Amount',
      type: 'short-input',
      placeholder: 'Line Amount',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_invoice_line'],
      },
    },
    {
      id: 'quantity',
      title: 'Quantity',
      type: 'short-input',
      placeholder: 'Quantity',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_invoice_line'],
      },
    },
    {
      id: 'unitSellingPrice',
      title: 'Unit Selling Price',
      type: 'short-input',
      placeholder: 'Unit Selling Price',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice_line',
          'oracle_fusion_financials_create_receivables_credit_memo_line',
        ],
      },
    },
    {
      id: 'unitOfMeasure',
      title: 'Unit Of Measure',
      type: 'short-input',
      placeholder: 'Unit Of Measure',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice_line',
          'oracle_fusion_financials_create_receivables_credit_memo_line',
        ],
      },
    },
    {
      id: 'accountingRule',
      title: 'Accounting Rule',
      type: 'short-input',
      placeholder: 'Accounting Rule',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_invoice_line'],
      },
    },
    {
      id: 'accountingRuleDuration',
      title: 'Accounting Rule Duration',
      type: 'short-input',
      placeholder: 'Accounting Rule Duration as an exact decimal string',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_invoice_line'],
      },
    },
    {
      id: 'ruleStartDate',
      title: 'Rule Start Date',
      type: 'short-input',
      placeholder: 'Rule Start Date (YYYY-MM-DD)',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_invoice_line'],
      },
    },
    {
      id: 'ruleEndDate',
      title: 'Rule End Date',
      type: 'short-input',
      placeholder: 'Rule End Date (YYYY-MM-DD)',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_invoice_line'],
      },
    },
    {
      id: 'taxClassificationCode',
      title: 'Tax Classification Code',
      type: 'short-input',
      placeholder: 'Tax Classification Code',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice_line',
          'oracle_fusion_financials_create_receivables_credit_memo_line',
        ],
      },
    },
    {
      id: 'salesOrder',
      title: 'Sales Order',
      type: 'short-input',
      placeholder: 'Sales Order',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_invoice_line'],
      },
    },
    {
      id: 'receivablesInvoiceDistributionId',
      title: 'Receivables Invoice Distribution Id',
      type: 'short-input',
      placeholder: 'Receivables Invoice Distribution Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_invoice_distribution'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_invoice_distribution'],
      },
    },
    {
      id: 'accountClass',
      title: 'Account Class',
      type: 'short-input',
      placeholder: 'Account Class',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice_distribution',
          'oracle_fusion_financials_create_receivables_credit_memo_distribution',
        ],
      },
    },
    {
      id: 'accountCombination',
      title: 'Account Combination',
      type: 'short-input',
      placeholder: 'Account Combination',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice_distribution',
          'oracle_fusion_financials_create_receivables_credit_memo_distribution',
        ],
      },
    },
    {
      id: 'accountedAmount',
      title: 'Accounted Amount',
      type: 'short-input',
      placeholder: 'Accounted Amount',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice_distribution',
          'oracle_fusion_financials_create_receivables_credit_memo_distribution',
        ],
      },
    },
    {
      id: 'amount',
      title: 'Amount',
      type: 'short-input',
      placeholder: 'Amount',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice_distribution',
          'oracle_fusion_financials_create_receivables_credit_memo_distribution',
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_receipt'],
      },
    },
    {
      id: 'invoiceLineNumber',
      title: 'Invoice Line Number',
      type: 'short-input',
      placeholder: 'Invoice Line Number',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_invoice_distribution'],
      },
    },
    {
      id: 'detailedTaxLineNumber',
      title: 'Detailed Tax Line Number',
      type: 'short-input',
      placeholder: 'Detailed Tax Line Number',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice_distribution',
          'oracle_fusion_financials_create_receivables_credit_memo_distribution',
        ],
      },
    },
    {
      id: 'percent',
      title: 'Percent',
      type: 'short-input',
      placeholder: 'Percent',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice_distribution',
          'oracle_fusion_financials_create_receivables_credit_memo_distribution',
        ],
      },
    },
    {
      id: 'receivablesInvoiceInstallmentId',
      title: 'Receivables Invoice Installment Id',
      type: 'short-input',
      placeholder: 'Receivables Invoice Installment Id',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_invoice_installment',
          'oracle_fusion_financials_update_receivables_invoice_installment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_invoice_installment',
          'oracle_fusion_financials_update_receivables_invoice_installment',
        ],
      },
    },
    {
      id: 'installmentDueDate',
      title: 'Installment Due Date',
      type: 'short-input',
      placeholder: 'Installment Due Date (YYYY-MM-DD)',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_update_receivables_invoice_installment'],
      },
    },
    {
      id: 'originalAmount',
      title: 'Original Amount',
      type: 'short-input',
      placeholder: 'Original Amount',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_update_receivables_invoice_installment'],
      },
    },
    {
      id: 'receivablesCreditMemoIdSelector',
      title: 'Receivables Credit Memo',
      type: 'project-selector',
      canonicalParamId: 'receivablesCreditMemoId',
      serviceId: 'oracle_fusion_financials',
      selectorKey: 'oracleFusionFinancials.receivablesCreditMemos',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select receivables credit memo',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_credit_memo',
          'oracle_fusion_financials_update_receivables_credit_memo',
          'oracle_fusion_financials_approve_receivables_credit_memo',
          'oracle_fusion_financials_rework_receivables_credit_memo',
          'oracle_fusion_financials_list_receivables_credit_memo_lines',
          'oracle_fusion_financials_get_receivables_credit_memo_line',
          'oracle_fusion_financials_create_receivables_credit_memo_line',
          'oracle_fusion_financials_list_receivables_credit_memo_distributions',
          'oracle_fusion_financials_get_receivables_credit_memo_distribution',
          'oracle_fusion_financials_create_receivables_credit_memo_distribution',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_credit_memo',
          'oracle_fusion_financials_update_receivables_credit_memo',
          'oracle_fusion_financials_approve_receivables_credit_memo',
          'oracle_fusion_financials_rework_receivables_credit_memo',
          'oracle_fusion_financials_list_receivables_credit_memo_lines',
          'oracle_fusion_financials_get_receivables_credit_memo_line',
          'oracle_fusion_financials_create_receivables_credit_memo_line',
          'oracle_fusion_financials_list_receivables_credit_memo_distributions',
          'oracle_fusion_financials_get_receivables_credit_memo_distribution',
          'oracle_fusion_financials_create_receivables_credit_memo_distribution',
        ],
      },
    },
    {
      id: 'receivablesCreditMemoIdManual',
      canonicalParamId: 'receivablesCreditMemoId',
      mode: 'advanced',
      title: 'Receivables Credit Memo Id',
      type: 'short-input',
      placeholder: 'Receivables Credit Memo Id',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_credit_memo',
          'oracle_fusion_financials_update_receivables_credit_memo',
          'oracle_fusion_financials_approve_receivables_credit_memo',
          'oracle_fusion_financials_rework_receivables_credit_memo',
          'oracle_fusion_financials_list_receivables_credit_memo_lines',
          'oracle_fusion_financials_get_receivables_credit_memo_line',
          'oracle_fusion_financials_create_receivables_credit_memo_line',
          'oracle_fusion_financials_list_receivables_credit_memo_distributions',
          'oracle_fusion_financials_get_receivables_credit_memo_distribution',
          'oracle_fusion_financials_create_receivables_credit_memo_distribution',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_credit_memo',
          'oracle_fusion_financials_update_receivables_credit_memo',
          'oracle_fusion_financials_approve_receivables_credit_memo',
          'oracle_fusion_financials_rework_receivables_credit_memo',
          'oracle_fusion_financials_list_receivables_credit_memo_lines',
          'oracle_fusion_financials_get_receivables_credit_memo_line',
          'oracle_fusion_financials_create_receivables_credit_memo_line',
          'oracle_fusion_financials_list_receivables_credit_memo_distributions',
          'oracle_fusion_financials_get_receivables_credit_memo_distribution',
          'oracle_fusion_financials_create_receivables_credit_memo_distribution',
        ],
      },
    },
    {
      id: 'creditMemoCurrency',
      title: 'Credit Memo Currency',
      type: 'short-input',
      placeholder: 'Credit Memo Currency',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo'],
      },
    },
    {
      id: 'creditMemoStatus',
      title: 'Credit Memo Status',
      type: 'short-input',
      placeholder: 'Credit Memo Status',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_update_receivables_credit_memo',
        ],
      },
    },
    {
      id: 'creditReason',
      title: 'Credit Reason',
      type: 'short-input',
      placeholder: 'Credit Reason',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo'],
      },
    },
    {
      id: 'freightCreditAmount',
      title: 'Freight Credit Amount',
      type: 'short-input',
      placeholder: 'Freight Credit Amount',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo'],
      },
    },
    {
      id: 'creditMemoComments',
      title: 'Credit Memo Comments',
      type: 'short-input',
      placeholder: 'Credit Memo Comments',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo'],
      },
    },
    {
      id: 'conversionRateDate',
      title: 'Conversion Rate Date',
      type: 'short-input',
      placeholder: 'Conversion Rate Date (YYYY-MM-DD)',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo'],
      },
    },
    {
      id: 'allowCompletion',
      title: 'Allow Completion',
      type: 'short-input',
      placeholder: 'Allow Completion',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_update_receivables_credit_memo'],
      },
    },
    {
      id: 'controlCompletionReason',
      title: 'Control Completion Reason',
      type: 'short-input',
      placeholder: 'Control Completion Reason',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_update_receivables_credit_memo'],
      },
    },
    {
      id: 'recipientEmail',
      title: 'Recipient Email',
      type: 'short-input',
      placeholder: 'Recipient Email',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_update_receivables_credit_memo'],
      },
    },
    {
      id: 'receivablesCreditMemoLineId',
      title: 'Receivables Credit Memo Line Id',
      type: 'short-input',
      placeholder: 'Receivables Credit Memo Line Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_credit_memo_line'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_credit_memo_line'],
      },
    },
    {
      id: 'lineDescription',
      title: 'Line Description',
      type: 'short-input',
      placeholder: 'Line Description',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo_line'],
      },
    },
    {
      id: 'lineAmountCredit',
      title: 'Line Amount Credit',
      type: 'short-input',
      placeholder: 'Line Amount Credit',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo_line'],
      },
    },
    {
      id: 'lineQuantityCredit',
      title: 'Line Quantity Credit',
      type: 'short-input',
      placeholder: 'Line Quantity Credit',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo_line'],
      },
    },
    {
      id: 'lineCreditReason',
      title: 'Line Credit Reason',
      type: 'short-input',
      placeholder: 'Line Credit Reason',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo_line'],
      },
    },
    {
      id: 'lineFreightCreditAmount',
      title: 'Line Freight Credit Amount',
      type: 'short-input',
      placeholder: 'Line Freight Credit Amount',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo_line'],
      },
    },
    {
      id: 'receivablesCreditMemoDistributionId',
      title: 'Receivables Credit Memo Distribution Id',
      type: 'short-input',
      placeholder: 'Receivables Credit Memo Distribution Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_credit_memo_distribution'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_credit_memo_distribution'],
      },
    },
    {
      id: 'creditMemoLineNumber',
      title: 'Credit Memo Line Number',
      type: 'short-input',
      placeholder: 'Credit Memo Line Number',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_credit_memo_distribution'],
      },
    },
    {
      id: 'receivablesReceiptIdSelector',
      title: 'Receivables Receipt',
      type: 'project-selector',
      canonicalParamId: 'receivablesReceiptId',
      serviceId: 'oracle_fusion_financials',
      selectorKey: 'oracleFusionFinancials.receivablesReceipts',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select receivables receipt',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
          'oracle_fusion_financials_delete_receivables_receipt',
          'oracle_fusion_financials_apply_receivables_receipt',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
          'oracle_fusion_financials_delete_receivables_receipt',
          'oracle_fusion_financials_apply_receivables_receipt',
        ],
      },
    },
    {
      id: 'receivablesReceiptIdManual',
      canonicalParamId: 'receivablesReceiptId',
      mode: 'advanced',
      title: 'Receivables Receipt Id',
      type: 'short-input',
      placeholder: 'Receivables Receipt Id',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
          'oracle_fusion_financials_delete_receivables_receipt',
          'oracle_fusion_financials_apply_receivables_receipt',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
          'oracle_fusion_financials_delete_receivables_receipt',
          'oracle_fusion_financials_apply_receivables_receipt',
        ],
      },
    },
    {
      id: 'currency',
      title: 'Currency',
      type: 'short-input',
      placeholder: 'Currency',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_receipt'],
      },
    },
    {
      id: 'receiptDate',
      title: 'Receipt Date',
      type: 'short-input',
      placeholder: 'Receipt Date (YYYY-MM-DD)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_receipt'],
      },
    },
    {
      id: 'receiptMethod',
      title: 'Receipt Method',
      type: 'short-input',
      placeholder: 'Receipt Method',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_receivables_receipt'],
      },
    },
    {
      id: 'receiptNumber',
      title: 'Receipt Number',
      type: 'short-input',
      placeholder: 'Receipt Number',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
    },
    {
      id: 'customerAccountNumber',
      title: 'Customer Account Number',
      type: 'short-input',
      placeholder: 'Customer Account Number',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
    },
    {
      id: 'customerName',
      title: 'Customer Name',
      type: 'short-input',
      placeholder: 'Customer Name',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
    },
    {
      id: 'customerSite',
      title: 'Customer Site',
      type: 'short-input',
      placeholder: 'Customer Site',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
    },
    {
      id: 'maturityDate',
      title: 'Maturity Date',
      type: 'short-input',
      placeholder: 'Maturity Date (YYYY-MM-DD)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
    },
    {
      id: 'structuredPaymentReference',
      title: 'Structured Payment Reference',
      type: 'short-input',
      placeholder: 'Structured Payment Reference',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_receivables_receipt',
        ],
      },
    },
    {
      id: 'appliedPaymentScheduleId',
      title: 'Applied Payment Schedule Id',
      type: 'short-input',
      placeholder: 'Invoice installment identifier as an exact decimal string',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_apply_receivables_receipt'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_apply_receivables_receipt'],
      },
    },
    {
      id: 'amountApplied',
      title: 'Amount Applied',
      type: 'short-input',
      placeholder: 'Amount to apply; omitted means the full open transaction balance',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_apply_receivables_receipt'],
      },
    },
    {
      id: 'calledFrom',
      title: 'Called From',
      type: 'short-input',
      placeholder: 'Caller or process name recorded for audit',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_apply_receivables_receipt'],
      },
    },
    {
      id: 'receivablesCustomerAccountIdSelector',
      title: 'Receivables Customer Account',
      type: 'project-selector',
      canonicalParamId: 'receivablesCustomerAccountId',
      serviceId: 'oracle_fusion_financials',
      selectorKey: 'oracleFusionFinancials.receivablesCustomerAccounts',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select receivables customer account',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_customer_account',
          'oracle_fusion_financials_list_receivables_receipt_applications',
          'oracle_fusion_financials_get_receivables_receipt_application',
          'oracle_fusion_financials_list_receivables_credit_memo_applications',
          'oracle_fusion_financials_get_receivables_credit_memo_application',
          'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
          'oracle_fusion_financials_get_receivables_transaction_payment_schedule',
          'oracle_fusion_financials_list_receivables_transaction_adjustments',
          'oracle_fusion_financials_get_receivables_transaction_adjustment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_customer_account',
          'oracle_fusion_financials_list_receivables_receipt_applications',
          'oracle_fusion_financials_get_receivables_receipt_application',
          'oracle_fusion_financials_list_receivables_credit_memo_applications',
          'oracle_fusion_financials_get_receivables_credit_memo_application',
          'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
          'oracle_fusion_financials_get_receivables_transaction_payment_schedule',
          'oracle_fusion_financials_list_receivables_transaction_adjustments',
          'oracle_fusion_financials_get_receivables_transaction_adjustment',
        ],
      },
    },
    {
      id: 'receivablesCustomerAccountIdManual',
      canonicalParamId: 'receivablesCustomerAccountId',
      mode: 'advanced',
      title: 'Receivables Customer Account Id',
      type: 'short-input',
      placeholder: 'Receivables Customer Account Id',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_customer_account',
          'oracle_fusion_financials_list_receivables_receipt_applications',
          'oracle_fusion_financials_get_receivables_receipt_application',
          'oracle_fusion_financials_list_receivables_credit_memo_applications',
          'oracle_fusion_financials_get_receivables_credit_memo_application',
          'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
          'oracle_fusion_financials_get_receivables_transaction_payment_schedule',
          'oracle_fusion_financials_list_receivables_transaction_adjustments',
          'oracle_fusion_financials_get_receivables_transaction_adjustment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_receivables_customer_account',
          'oracle_fusion_financials_list_receivables_receipt_applications',
          'oracle_fusion_financials_get_receivables_receipt_application',
          'oracle_fusion_financials_list_receivables_credit_memo_applications',
          'oracle_fusion_financials_get_receivables_credit_memo_application',
          'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
          'oracle_fusion_financials_get_receivables_transaction_payment_schedule',
          'oracle_fusion_financials_list_receivables_transaction_adjustments',
          'oracle_fusion_financials_get_receivables_transaction_adjustment',
        ],
      },
    },
    {
      id: 'receivablesCustomerAccountSiteIdSelector',
      title: 'Receivables Customer Account Site',
      type: 'project-selector',
      canonicalParamId: 'receivablesCustomerAccountSiteId',
      serviceId: 'oracle_fusion_financials',
      selectorKey: 'oracleFusionFinancials.receivablesCustomerAccountSites',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select receivables customer account site',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_customer_account_site'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_customer_account_site'],
      },
    },
    {
      id: 'receivablesCustomerAccountSiteIdManual',
      canonicalParamId: 'receivablesCustomerAccountSiteId',
      mode: 'advanced',
      title: 'Receivables Customer Account Site Id',
      type: 'short-input',
      placeholder: 'Receivables Customer Account Site Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_customer_account_site'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_customer_account_site'],
      },
    },
    {
      id: 'receivablesReceiptApplicationId',
      title: 'Receivables Receipt Application Id',
      type: 'short-input',
      placeholder: 'Receivables Receipt Application Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_receipt_application'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_receipt_application'],
      },
    },
    {
      id: 'receivablesCreditMemoApplicationId',
      title: 'Receivables Credit Memo Application Id',
      type: 'short-input',
      placeholder: 'Receivables Credit Memo Application Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_credit_memo_application'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_credit_memo_application'],
      },
    },
    {
      id: 'receivablesTransactionPaymentScheduleId',
      title: 'Receivables Transaction Payment Schedule Id',
      type: 'short-input',
      placeholder: 'Receivables Transaction Payment Schedule Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_transaction_payment_schedule'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_transaction_payment_schedule'],
      },
    },
    {
      id: 'receivablesTransactionAdjustmentId',
      title: 'Receivables Transaction Adjustment Id',
      type: 'short-input',
      placeholder: 'Receivables Transaction Adjustment Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_transaction_adjustment'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_receivables_transaction_adjustment'],
      },
    },
    {
      id: 'expenseReportUniqIdSelector',
      title: 'Expense Report',
      type: 'project-selector',
      canonicalParamId: 'expenseReportUniqId',
      serviceId: 'oracle_fusion_financials',
      selectorKey: 'oracleFusionFinancials.expenseReports',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select expense report',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_expense_report',
          'oracle_fusion_financials_update_expense_report',
          'oracle_fusion_financials_submit_expense_report',
          'oracle_fusion_financials_remove_expense_report_cash_advance',
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_get_expense_line',
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_list_expense_distributions',
          'oracle_fusion_financials_get_expense_distribution',
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
          'oracle_fusion_financials_list_expense_itemizations',
          'oracle_fusion_financials_get_expense_itemization',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
          'oracle_fusion_financials_list_expense_report_processing_details',
          'oracle_fusion_financials_get_expense_report_processing_detail',
          'oracle_fusion_financials_list_expense_report_payments',
          'oracle_fusion_financials_get_expense_report_payment',
          'oracle_fusion_financials_list_expense_line_errors',
          'oracle_fusion_financials_get_expense_line_error',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_expense_report',
          'oracle_fusion_financials_update_expense_report',
          'oracle_fusion_financials_submit_expense_report',
          'oracle_fusion_financials_remove_expense_report_cash_advance',
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_get_expense_line',
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_list_expense_distributions',
          'oracle_fusion_financials_get_expense_distribution',
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
          'oracle_fusion_financials_list_expense_itemizations',
          'oracle_fusion_financials_get_expense_itemization',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
          'oracle_fusion_financials_list_expense_report_processing_details',
          'oracle_fusion_financials_get_expense_report_processing_detail',
          'oracle_fusion_financials_list_expense_report_payments',
          'oracle_fusion_financials_get_expense_report_payment',
          'oracle_fusion_financials_list_expense_line_errors',
          'oracle_fusion_financials_get_expense_line_error',
        ],
      },
    },
    {
      id: 'expenseReportUniqIdManual',
      canonicalParamId: 'expenseReportUniqId',
      mode: 'advanced',
      title: 'Expense Report Uniq Id',
      type: 'short-input',
      placeholder: 'Expense Report Uniq Id',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_expense_report',
          'oracle_fusion_financials_update_expense_report',
          'oracle_fusion_financials_submit_expense_report',
          'oracle_fusion_financials_remove_expense_report_cash_advance',
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_get_expense_line',
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_list_expense_distributions',
          'oracle_fusion_financials_get_expense_distribution',
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
          'oracle_fusion_financials_list_expense_itemizations',
          'oracle_fusion_financials_get_expense_itemization',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
          'oracle_fusion_financials_list_expense_report_processing_details',
          'oracle_fusion_financials_get_expense_report_processing_detail',
          'oracle_fusion_financials_list_expense_report_payments',
          'oracle_fusion_financials_get_expense_report_payment',
          'oracle_fusion_financials_list_expense_line_errors',
          'oracle_fusion_financials_get_expense_line_error',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_expense_report',
          'oracle_fusion_financials_update_expense_report',
          'oracle_fusion_financials_submit_expense_report',
          'oracle_fusion_financials_remove_expense_report_cash_advance',
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_get_expense_line',
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_list_expense_distributions',
          'oracle_fusion_financials_get_expense_distribution',
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
          'oracle_fusion_financials_list_expense_itemizations',
          'oracle_fusion_financials_get_expense_itemization',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
          'oracle_fusion_financials_list_expense_report_processing_details',
          'oracle_fusion_financials_get_expense_report_processing_detail',
          'oracle_fusion_financials_list_expense_report_payments',
          'oracle_fusion_financials_get_expense_report_payment',
          'oracle_fusion_financials_list_expense_line_errors',
          'oracle_fusion_financials_get_expense_line_error',
        ],
      },
    },
    {
      id: 'orgId',
      title: 'Org Id',
      type: 'short-input',
      placeholder: 'Org Id as an exact integer string',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
        ],
      },
    },
    {
      id: 'personId',
      title: 'Person Id',
      type: 'short-input',
      placeholder: 'Person Id as an exact integer string',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_expense_line'],
      },
    },
    {
      id: 'assignmentId',
      title: 'Assignment Id',
      type: 'short-input',
      placeholder: 'Assignment Id as an exact integer string',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_expense_line'],
      },
    },
    {
      id: 'preparerId',
      title: 'Preparer Id',
      type: 'short-input',
      placeholder: 'Preparer Id as an exact integer string',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_expense_report'],
      },
    },
    {
      id: 'purpose',
      title: 'Purpose',
      type: 'short-input',
      placeholder: 'Purpose',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
    },
    {
      id: 'expenseReportNumber',
      title: 'Expense Report Number',
      type: 'short-input',
      placeholder: 'Expense Report Number',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_expense_report'],
      },
    },
    {
      id: 'expenseReportDate',
      title: 'Expense Report Date',
      type: 'short-input',
      placeholder: 'Expense Report Date (YYYY-MM-DD)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
    },
    {
      id: 'reimbursementCurrencyCode',
      title: 'Reimbursement Currency Code',
      type: 'short-input',
      placeholder: 'Reimbursement Currency Code',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'exchangeRateType',
      title: 'Exchange Rate Type',
      type: 'short-input',
      placeholder: 'Exchange Rate Type',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
    },
    {
      id: 'paymentMethodCode',
      title: 'Payment Method Code',
      type: 'short-input',
      placeholder: 'Payment Method Code',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
    },
    {
      id: 'overrideApproverId',
      title: 'Override Approver Id',
      type: 'short-input',
      placeholder: 'Override Approver Id as an exact integer string',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
    },
    {
      id: 'unappliedAdvancesJust',
      title: 'Unapplied Advances Just',
      type: 'short-input',
      placeholder: 'Unapplied Advances Just',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
    },
    {
      id: 'unappliedCashAdvReason',
      title: 'Unapplied Cash Adv Reason',
      type: 'short-input',
      placeholder: 'Unapplied Cash Adv Reason',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
    },
    {
      id: 'cashAdvanceNumber',
      title: 'Cash Advance Number',
      type: 'short-input',
      placeholder: 'Number of the specific cash advance to remove',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_remove_expense_report_cash_advance'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_remove_expense_report_cash_advance'],
      },
    },
    {
      id: 'expenseLineUniqId',
      title: 'Expense Line Uniq Id',
      type: 'short-input',
      placeholder: 'Expense Line Uniq Id',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_list_expense_distributions',
          'oracle_fusion_financials_get_expense_distribution',
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
          'oracle_fusion_financials_list_expense_itemizations',
          'oracle_fusion_financials_get_expense_itemization',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
          'oracle_fusion_financials_list_expense_line_errors',
          'oracle_fusion_financials_get_expense_line_error',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_list_expense_distributions',
          'oracle_fusion_financials_get_expense_distribution',
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
          'oracle_fusion_financials_list_expense_itemizations',
          'oracle_fusion_financials_get_expense_itemization',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
          'oracle_fusion_financials_list_expense_line_errors',
          'oracle_fusion_financials_get_expense_line_error',
        ],
      },
    },
    {
      id: 'ticketClass',
      title: 'Ticket Class',
      type: 'short-input',
      placeholder: 'Ticket Class',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_create_expense_line'],
      },
    },
    {
      id: 'expenseTypeId',
      title: 'Expense Type Id',
      type: 'short-input',
      placeholder: 'Expense Type Id as an exact integer string',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'expenseTemplateId',
      title: 'Expense Template Id',
      type: 'short-input',
      placeholder: 'Expense Template Id as an exact integer string',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'justification',
      title: 'Justification',
      type: 'short-input',
      placeholder: 'Justification',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'receiptAmount',
      title: 'Receipt Amount',
      type: 'short-input',
      placeholder: 'Receipt Amount',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'receiptCurrencyCode',
      title: 'Receipt Currency Code',
      type: 'short-input',
      placeholder: 'Receipt Currency Code',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'merchantName',
      title: 'Merchant Name',
      type: 'short-input',
      placeholder: 'Merchant Name',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'Start Date (YYYY-MM-DD)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'End Date',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'exchangeRate',
      title: 'Exchange Rate',
      type: 'short-input',
      placeholder: 'Exchange Rate',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'itemizationParentExpenseId',
      title: 'Itemization Parent Expense Id',
      type: 'short-input',
      placeholder: 'Itemization Parent Expense Id as an exact integer string',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'receiptMissingFlag',
      title: 'Receipt Missing Flag',
      type: 'dropdown',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      placeholder: 'Receipt Missing Flag',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'location',
      title: 'Location',
      type: 'short-input',
      placeholder: 'Location',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'countryCode',
      title: 'Country Code',
      type: 'short-input',
      placeholder: 'Country Code',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
    },
    {
      id: 'expenseCategoryCode',
      title: 'Expense Category Code',
      type: 'short-input',
      placeholder: 'Expense Category Code',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'expenseSource',
      title: 'Expense Source',
      type: 'short-input',
      placeholder: 'Expense Source',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
    },
    {
      id: 'numberOfDays',
      title: 'Number Of Days',
      type: 'short-input',
      placeholder: 'Number Of Days',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'numberOfAttendees',
      title: 'Number Of Attendees',
      type: 'short-input',
      placeholder: 'Number Of Attendees',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_create_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'tripDistance',
      title: 'Trip Distance',
      type: 'short-input',
      placeholder: 'Trip Distance',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
    },
    {
      id: 'distanceUnitCode',
      title: 'Distance Unit Code',
      type: 'short-input',
      placeholder: 'Distance Unit Code',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
    },
    {
      id: 'ticketClassCode',
      title: 'Ticket Class Code',
      type: 'short-input',
      placeholder: 'Ticket Class Code',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
    },
    {
      id: 'ticketNumber',
      title: 'Ticket Number',
      type: 'short-input',
      placeholder: 'Ticket Number',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
    },
    {
      id: 'expenseDistributionId',
      title: 'Expense Distribution Id',
      type: 'short-input',
      placeholder: 'Expense Distribution Id',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
        ],
      },
    },
    {
      id: 'expenseId',
      title: 'Expense Id',
      type: 'short-input',
      placeholder: 'Expense Id as an exact integer string',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
        ],
      },
    },
    {
      id: 'codeCombinationId',
      title: 'Code Combination Id',
      type: 'short-input',
      placeholder: 'Code Combination Id as an exact integer string',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
        ],
      },
    },
    {
      id: 'company',
      title: 'Company',
      type: 'short-input',
      placeholder: 'Company',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
        ],
      },
    },
    {
      id: 'costCenter',
      title: 'Cost Center',
      type: 'short-input',
      placeholder: 'Cost Center',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
        ],
      },
    },
    {
      id: 'reimbursableAmount',
      title: 'Reimbursable Amount',
      type: 'short-input',
      placeholder: 'Reimbursable Amount',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_distribution',
          'oracle_fusion_financials_update_expense_distribution',
        ],
      },
    },
    {
      id: 'expenseItemizationId',
      title: 'Expense Itemization Id',
      type: 'short-input',
      placeholder: 'Expense Itemization Id',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_expense_itemization',
          'oracle_fusion_financials_update_expense_itemization',
        ],
      },
    },
    {
      id: 'expenseReportProcessingDetailUniqId',
      title: 'Expense Report Processing Detail Uniq Id',
      type: 'short-input',
      placeholder: 'Expense Report Processing Detail Uniq Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_expense_report_processing_detail'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_expense_report_processing_detail'],
      },
    },
    {
      id: 'expenseReportPaymentId',
      title: 'Expense Report Payment Id',
      type: 'short-input',
      placeholder: 'Expense Report Payment Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_expense_report_payment'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_expense_report_payment'],
      },
    },
    {
      id: 'expenseLineErrorSequence',
      title: 'Expense Line Error Sequence',
      type: 'short-input',
      placeholder: 'Expense Line Error Sequence',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_expense_line_error'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_expense_line_error'],
      },
    },
    {
      id: 'glLedgerIdSelector',
      title: 'Gl Ledger',
      type: 'project-selector',
      canonicalParamId: 'glLedgerId',
      serviceId: 'oracle_fusion_financials',
      selectorKey: 'oracleFusionFinancials.glLedgers',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select gl ledger',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_gl_ledger'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_gl_ledger'],
      },
    },
    {
      id: 'glLedgerIdManual',
      canonicalParamId: 'glLedgerId',
      mode: 'advanced',
      title: 'Gl Ledger Id',
      type: 'short-input',
      placeholder: 'Gl Ledger Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_gl_ledger'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_gl_ledger'],
      },
    },
    {
      id: 'glJournalBatchIdSelector',
      title: 'Gl Journal Batch',
      type: 'project-selector',
      canonicalParamId: 'glJournalBatchId',
      serviceId: 'oracle_fusion_financials',
      selectorKey: 'oracleFusionFinancials.glJournalBatches',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select gl journal batch',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_gl_journal_batch',
          'oracle_fusion_financials_delete_gl_journal_batch',
          'oracle_fusion_financials_list_gl_journal_headers',
          'oracle_fusion_financials_get_gl_journal_header',
          'oracle_fusion_financials_list_gl_journal_lines',
          'oracle_fusion_financials_get_gl_journal_line',
          'oracle_fusion_financials_list_gl_journal_errors',
          'oracle_fusion_financials_get_gl_journal_error',
          'oracle_fusion_financials_list_gl_journal_action_logs',
          'oracle_fusion_financials_get_gl_journal_action_log',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_gl_journal_batch',
          'oracle_fusion_financials_delete_gl_journal_batch',
          'oracle_fusion_financials_list_gl_journal_headers',
          'oracle_fusion_financials_get_gl_journal_header',
          'oracle_fusion_financials_list_gl_journal_lines',
          'oracle_fusion_financials_get_gl_journal_line',
          'oracle_fusion_financials_list_gl_journal_errors',
          'oracle_fusion_financials_get_gl_journal_error',
          'oracle_fusion_financials_list_gl_journal_action_logs',
          'oracle_fusion_financials_get_gl_journal_action_log',
        ],
      },
    },
    {
      id: 'glJournalBatchIdManual',
      canonicalParamId: 'glJournalBatchId',
      mode: 'advanced',
      title: 'Gl Journal Batch Id',
      type: 'short-input',
      placeholder: 'Gl Journal Batch Id',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_gl_journal_batch',
          'oracle_fusion_financials_delete_gl_journal_batch',
          'oracle_fusion_financials_list_gl_journal_headers',
          'oracle_fusion_financials_get_gl_journal_header',
          'oracle_fusion_financials_list_gl_journal_lines',
          'oracle_fusion_financials_get_gl_journal_line',
          'oracle_fusion_financials_list_gl_journal_errors',
          'oracle_fusion_financials_get_gl_journal_error',
          'oracle_fusion_financials_list_gl_journal_action_logs',
          'oracle_fusion_financials_get_gl_journal_action_log',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_gl_journal_batch',
          'oracle_fusion_financials_delete_gl_journal_batch',
          'oracle_fusion_financials_list_gl_journal_headers',
          'oracle_fusion_financials_get_gl_journal_header',
          'oracle_fusion_financials_list_gl_journal_lines',
          'oracle_fusion_financials_get_gl_journal_line',
          'oracle_fusion_financials_list_gl_journal_errors',
          'oracle_fusion_financials_get_gl_journal_error',
          'oracle_fusion_financials_list_gl_journal_action_logs',
          'oracle_fusion_financials_get_gl_journal_action_log',
        ],
      },
    },
    {
      id: 'glJournalHeaderUniqId',
      title: 'Gl Journal Header Uniq Id',
      type: 'short-input',
      placeholder: 'Gl Journal Header Uniq Id',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_gl_journal_header',
          'oracle_fusion_financials_list_gl_journal_lines',
          'oracle_fusion_financials_get_gl_journal_line',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_gl_journal_header',
          'oracle_fusion_financials_list_gl_journal_lines',
          'oracle_fusion_financials_get_gl_journal_line',
        ],
      },
    },
    {
      id: 'glJournalLineUniqId',
      title: 'Gl Journal Line Uniq Id',
      type: 'short-input',
      placeholder: 'Gl Journal Line Uniq Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_gl_journal_line'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_gl_journal_line'],
      },
    },
    {
      id: 'glJournalErrorUniqId',
      title: 'Gl Journal Error Uniq Id',
      type: 'short-input',
      placeholder: 'Gl Journal Error Uniq Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_gl_journal_error'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_gl_journal_error'],
      },
    },
    {
      id: 'glJournalActionLogUniqId',
      title: 'Gl Journal Action Log Uniq Id',
      type: 'short-input',
      placeholder: 'Gl Journal Action Log Uniq Id',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_gl_journal_action_log'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_financials_get_gl_journal_action_log'],
      },
    },
    {
      id: 'q',
      title: 'Filter',
      type: 'long-input',
      placeholder: 'Oracle REST Framework q expression',
      wandConfig: {
        enabled: true,
        prompt: `Generate an Oracle Fusion Cloud Financials REST Framework q filter from the user's request.

Rules:
- Use only queryable attributes documented by Oracle for the selected Financials collection
- Preserve Oracle attribute capitalization
- Follow Oracle's expression syntax, such as AmountPaid=0;InvoiceDate>=2026-01-01
- Separate multiple expressions with semicolons
- Do not include a leading q=, URL encoding, fields, expand, or explanatory text

Return ONLY the q filter expression - no explanations or extra text.`,
        placeholder: 'Describe the Financials records to filter',
      },
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_list_payment_process_requests',
          'oracle_fusion_financials_list_payables_invoice_holds',
          'oracle_fusion_financials_list_payables_payment_terms',
          'oracle_fusion_financials_list_payables_payment_term_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoice_distributions',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_credit_memo_lines',
          'oracle_fusion_financials_list_receivables_credit_memo_distributions',
          'oracle_fusion_financials_list_receivables_receipts',
          'oracle_fusion_financials_list_receivables_customer_accounts',
          'oracle_fusion_financials_list_receivables_customer_account_sites',
          'oracle_fusion_financials_list_receivables_receipt_applications',
          'oracle_fusion_financials_list_receivables_credit_memo_applications',
          'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
          'oracle_fusion_financials_list_receivables_transaction_adjustments',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_distributions',
          'oracle_fusion_financials_list_expense_itemizations',
          'oracle_fusion_financials_list_expense_report_processing_details',
          'oracle_fusion_financials_list_expense_report_payments',
          'oracle_fusion_financials_list_expense_line_errors',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_journal_headers',
          'oracle_fusion_financials_list_gl_journal_lines',
          'oracle_fusion_financials_list_gl_journal_errors',
          'oracle_fusion_financials_list_gl_journal_action_logs',
          'oracle_fusion_financials_list_gl_balances',
        ],
      },
    },
    {
      id: 'finder',
      title: 'Finder',
      type: 'long-input',
      placeholder: 'FinderName;Variable=Value',
      wandConfig: {
        enabled: true,
        prompt: `Generate an Oracle Fusion Cloud Financials predefined finder expression from the user's request.

Use only these Oracle-documented finders for the selected operation:
- Invoices: PrimaryKey;InvoiceId=<integer>
- Invoice lines: PrimaryKey;LineNumber=<integer>
- Invoice installments: PrimaryKey;InstallmentNumber=<integer>
- Payments: PaidInvoicesFinder;InvoiceNumber=<string> or PrimaryKey;CheckId=<integer>
- Payment-related invoices: PrimaryKey;InvoicePaymentId=<integer>

For every other collection, use a finder only when the selected endpoint's Oracle documentation explicitly lists its name and variables.

Use exactly one finder and its documented variable. Do not invent finder names or variables, include a leading finder=, URL-encode the value, or add explanatory text.

Return ONLY the finder expression - no explanations or extra text.`,
        placeholder: 'Describe the documented finder and value to use',
      },
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_list_payment_process_requests',
          'oracle_fusion_financials_list_payables_invoice_holds',
          'oracle_fusion_financials_list_payables_payment_terms',
          'oracle_fusion_financials_list_payables_payment_term_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoice_distributions',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_credit_memo_lines',
          'oracle_fusion_financials_list_receivables_credit_memo_distributions',
          'oracle_fusion_financials_list_receivables_receipts',
          'oracle_fusion_financials_list_receivables_customer_accounts',
          'oracle_fusion_financials_list_receivables_customer_account_sites',
          'oracle_fusion_financials_list_receivables_receipt_applications',
          'oracle_fusion_financials_list_receivables_credit_memo_applications',
          'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
          'oracle_fusion_financials_list_receivables_transaction_adjustments',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_distributions',
          'oracle_fusion_financials_list_expense_itemizations',
          'oracle_fusion_financials_list_expense_report_processing_details',
          'oracle_fusion_financials_list_expense_report_payments',
          'oracle_fusion_financials_list_expense_line_errors',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_journal_headers',
          'oracle_fusion_financials_list_gl_journal_lines',
          'oracle_fusion_financials_list_gl_journal_errors',
          'oracle_fusion_financials_list_gl_journal_action_logs',
          'oracle_fusion_financials_list_gl_balances',
        ],
      },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'InvoiceDate:desc',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_list_payment_process_requests',
          'oracle_fusion_financials_list_payables_invoice_holds',
          'oracle_fusion_financials_list_payables_payment_terms',
          'oracle_fusion_financials_list_payables_payment_term_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoice_distributions',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_credit_memo_lines',
          'oracle_fusion_financials_list_receivables_credit_memo_distributions',
          'oracle_fusion_financials_list_receivables_receipts',
          'oracle_fusion_financials_list_receivables_customer_accounts',
          'oracle_fusion_financials_list_receivables_customer_account_sites',
          'oracle_fusion_financials_list_receivables_receipt_applications',
          'oracle_fusion_financials_list_receivables_credit_memo_applications',
          'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
          'oracle_fusion_financials_list_receivables_transaction_adjustments',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_distributions',
          'oracle_fusion_financials_list_expense_itemizations',
          'oracle_fusion_financials_list_expense_report_processing_details',
          'oracle_fusion_financials_list_expense_report_payments',
          'oracle_fusion_financials_list_expense_line_errors',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_journal_headers',
          'oracle_fusion_financials_list_gl_journal_lines',
          'oracle_fusion_financials_list_gl_journal_errors',
          'oracle_fusion_financials_list_gl_journal_action_logs',
          'oracle_fusion_financials_list_gl_balances',
        ],
      },
    },
    {
      id: 'effectiveDate',
      title: 'Effective Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_list_payables_invoices',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '50 (maximum 100)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_list_payment_process_requests',
          'oracle_fusion_financials_list_payables_invoice_holds',
          'oracle_fusion_financials_list_payables_payment_terms',
          'oracle_fusion_financials_list_payables_payment_term_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoice_distributions',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_credit_memo_lines',
          'oracle_fusion_financials_list_receivables_credit_memo_distributions',
          'oracle_fusion_financials_list_receivables_receipts',
          'oracle_fusion_financials_list_receivables_customer_accounts',
          'oracle_fusion_financials_list_receivables_customer_account_sites',
          'oracle_fusion_financials_list_receivables_receipt_applications',
          'oracle_fusion_financials_list_receivables_credit_memo_applications',
          'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
          'oracle_fusion_financials_list_receivables_transaction_adjustments',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_distributions',
          'oracle_fusion_financials_list_expense_itemizations',
          'oracle_fusion_financials_list_expense_report_processing_details',
          'oracle_fusion_financials_list_expense_report_payments',
          'oracle_fusion_financials_list_expense_line_errors',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_journal_headers',
          'oracle_fusion_financials_list_gl_journal_lines',
          'oracle_fusion_financials_list_gl_journal_errors',
          'oracle_fusion_financials_list_gl_journal_action_logs',
          'oracle_fusion_financials_list_gl_balances',
        ],
      },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_list_payment_process_requests',
          'oracle_fusion_financials_list_payables_invoice_holds',
          'oracle_fusion_financials_list_payables_payment_terms',
          'oracle_fusion_financials_list_payables_payment_term_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoice_distributions',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_credit_memo_lines',
          'oracle_fusion_financials_list_receivables_credit_memo_distributions',
          'oracle_fusion_financials_list_receivables_receipts',
          'oracle_fusion_financials_list_receivables_customer_accounts',
          'oracle_fusion_financials_list_receivables_customer_account_sites',
          'oracle_fusion_financials_list_receivables_receipt_applications',
          'oracle_fusion_financials_list_receivables_credit_memo_applications',
          'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
          'oracle_fusion_financials_list_receivables_transaction_adjustments',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_distributions',
          'oracle_fusion_financials_list_expense_itemizations',
          'oracle_fusion_financials_list_expense_report_processing_details',
          'oracle_fusion_financials_list_expense_report_payments',
          'oracle_fusion_financials_list_expense_line_errors',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_journal_headers',
          'oracle_fusion_financials_list_gl_journal_lines',
          'oracle_fusion_financials_list_gl_journal_errors',
          'oracle_fusion_financials_list_gl_journal_action_logs',
          'oracle_fusion_financials_list_gl_balances',
        ],
      },
    },
    {
      id: 'totalResults',
      title: 'Include Total Results',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_list_payment_process_requests',
          'oracle_fusion_financials_list_payables_invoice_holds',
          'oracle_fusion_financials_list_payables_payment_terms',
          'oracle_fusion_financials_list_payables_payment_term_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoice_distributions',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_credit_memo_lines',
          'oracle_fusion_financials_list_receivables_credit_memo_distributions',
          'oracle_fusion_financials_list_receivables_receipts',
          'oracle_fusion_financials_list_receivables_customer_accounts',
          'oracle_fusion_financials_list_receivables_customer_account_sites',
          'oracle_fusion_financials_list_receivables_receipt_applications',
          'oracle_fusion_financials_list_receivables_credit_memo_applications',
          'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
          'oracle_fusion_financials_list_receivables_transaction_adjustments',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_distributions',
          'oracle_fusion_financials_list_expense_itemizations',
          'oracle_fusion_financials_list_expense_report_processing_details',
          'oracle_fusion_financials_list_expense_report_payments',
          'oracle_fusion_financials_list_expense_line_errors',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_journal_headers',
          'oracle_fusion_financials_list_gl_journal_lines',
          'oracle_fusion_financials_list_gl_journal_errors',
          'oracle_fusion_financials_list_gl_journal_action_logs',
          'oracle_fusion_financials_list_gl_balances',
        ],
      },
    },
  ],
  tools: {
    access: [
      'oracle_fusion_financials_list_receivables_invoices',
      'oracle_fusion_financials_get_receivables_invoice',
      'oracle_fusion_financials_create_receivables_invoice',
      'oracle_fusion_financials_update_receivables_invoice',
      'oracle_fusion_financials_delete_receivables_invoice',
      'oracle_fusion_financials_approve_receivables_invoice',
      'oracle_fusion_financials_rework_receivables_invoice',
      'oracle_fusion_financials_list_receivables_invoice_lines',
      'oracle_fusion_financials_get_receivables_invoice_line',
      'oracle_fusion_financials_create_receivables_invoice_line',
      'oracle_fusion_financials_list_receivables_invoice_distributions',
      'oracle_fusion_financials_get_receivables_invoice_distribution',
      'oracle_fusion_financials_create_receivables_invoice_distribution',
      'oracle_fusion_financials_list_receivables_invoice_installments',
      'oracle_fusion_financials_get_receivables_invoice_installment',
      'oracle_fusion_financials_update_receivables_invoice_installment',
      'oracle_fusion_financials_list_receivables_credit_memos',
      'oracle_fusion_financials_get_receivables_credit_memo',
      'oracle_fusion_financials_create_receivables_credit_memo',
      'oracle_fusion_financials_update_receivables_credit_memo',
      'oracle_fusion_financials_approve_receivables_credit_memo',
      'oracle_fusion_financials_rework_receivables_credit_memo',
      'oracle_fusion_financials_list_receivables_credit_memo_lines',
      'oracle_fusion_financials_get_receivables_credit_memo_line',
      'oracle_fusion_financials_create_receivables_credit_memo_line',
      'oracle_fusion_financials_list_receivables_credit_memo_distributions',
      'oracle_fusion_financials_get_receivables_credit_memo_distribution',
      'oracle_fusion_financials_create_receivables_credit_memo_distribution',
      'oracle_fusion_financials_list_receivables_receipts',
      'oracle_fusion_financials_get_receivables_receipt',
      'oracle_fusion_financials_create_receivables_receipt',
      'oracle_fusion_financials_update_receivables_receipt',
      'oracle_fusion_financials_delete_receivables_receipt',
      'oracle_fusion_financials_apply_receivables_receipt',
      'oracle_fusion_financials_list_receivables_customer_accounts',
      'oracle_fusion_financials_get_receivables_customer_account',
      'oracle_fusion_financials_list_receivables_customer_account_sites',
      'oracle_fusion_financials_get_receivables_customer_account_site',
      'oracle_fusion_financials_list_receivables_receipt_applications',
      'oracle_fusion_financials_get_receivables_receipt_application',
      'oracle_fusion_financials_list_receivables_credit_memo_applications',
      'oracle_fusion_financials_get_receivables_credit_memo_application',
      'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
      'oracle_fusion_financials_get_receivables_transaction_payment_schedule',
      'oracle_fusion_financials_list_receivables_transaction_adjustments',
      'oracle_fusion_financials_get_receivables_transaction_adjustment',
      'oracle_fusion_financials_list_expense_reports',
      'oracle_fusion_financials_get_expense_report',
      'oracle_fusion_financials_create_expense_report',
      'oracle_fusion_financials_update_expense_report',
      'oracle_fusion_financials_submit_expense_report',
      'oracle_fusion_financials_remove_expense_report_cash_advance',
      'oracle_fusion_financials_list_expense_lines',
      'oracle_fusion_financials_get_expense_line',
      'oracle_fusion_financials_create_expense_line',
      'oracle_fusion_financials_update_expense_line',
      'oracle_fusion_financials_list_expense_distributions',
      'oracle_fusion_financials_get_expense_distribution',
      'oracle_fusion_financials_create_expense_distribution',
      'oracle_fusion_financials_update_expense_distribution',
      'oracle_fusion_financials_list_expense_itemizations',
      'oracle_fusion_financials_get_expense_itemization',
      'oracle_fusion_financials_create_expense_itemization',
      'oracle_fusion_financials_update_expense_itemization',
      'oracle_fusion_financials_list_expense_report_processing_details',
      'oracle_fusion_financials_get_expense_report_processing_detail',
      'oracle_fusion_financials_list_expense_report_payments',
      'oracle_fusion_financials_get_expense_report_payment',
      'oracle_fusion_financials_list_expense_line_errors',
      'oracle_fusion_financials_get_expense_line_error',
      'oracle_fusion_financials_list_gl_ledgers',
      'oracle_fusion_financials_get_gl_ledger',
      'oracle_fusion_financials_list_gl_journal_batches',
      'oracle_fusion_financials_get_gl_journal_batch',
      'oracle_fusion_financials_delete_gl_journal_batch',
      'oracle_fusion_financials_list_gl_journal_headers',
      'oracle_fusion_financials_get_gl_journal_header',
      'oracle_fusion_financials_list_gl_journal_lines',
      'oracle_fusion_financials_get_gl_journal_line',
      'oracle_fusion_financials_list_gl_journal_errors',
      'oracle_fusion_financials_get_gl_journal_error',
      'oracle_fusion_financials_list_gl_journal_action_logs',
      'oracle_fusion_financials_get_gl_journal_action_log',
      'oracle_fusion_financials_list_gl_balances',
      'oracle_fusion_financials_list_payables_invoices',
      'oracle_fusion_financials_get_payables_invoice',
      'oracle_fusion_financials_list_payables_invoice_lines',
      'oracle_fusion_financials_get_payables_invoice_line',
      'oracle_fusion_financials_list_payables_invoice_installments',
      'oracle_fusion_financials_get_payables_invoice_installment',
      'oracle_fusion_financials_list_payables_invoice_distributions',
      'oracle_fusion_financials_get_payables_invoice_distribution',
      'oracle_fusion_financials_list_payables_applied_prepayments',
      'oracle_fusion_financials_get_payables_applied_prepayment',
      'oracle_fusion_financials_list_payables_available_prepayments',
      'oracle_fusion_financials_get_payables_available_prepayment',
      'oracle_fusion_financials_list_payables_payments',
      'oracle_fusion_financials_get_payables_payment',
      'oracle_fusion_financials_list_payables_payment_related_invoices',
      'oracle_fusion_financials_get_payables_payment_related_invoice',
      'oracle_fusion_financials_list_payment_process_requests',
      'oracle_fusion_financials_get_payment_process_request',
      'oracle_fusion_financials_list_payables_invoice_holds',
      'oracle_fusion_financials_get_payables_invoice_hold',
      'oracle_fusion_financials_list_payables_payment_terms',
      'oracle_fusion_financials_get_payables_payment_term',
      'oracle_fusion_financials_list_payables_payment_term_lines',
      'oracle_fusion_financials_get_payables_payment_term_line',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const { operation: _operation, ...rest } = params
        return {
          ...rest,
          ...financialsWriteParams(_operation, rest),
          q: optionalString(rest.q, 'Filter'),
          finder: optionalString(rest.finder, 'Finder'),
          orderBy: optionalString(rest.orderBy, 'Order By'),
          effectiveDate: optionalString(rest.effectiveDate, 'Effective Date'),
          limit: parseOptionalNumberInput(rest.limit, 'Limit', {
            integer: true,
            min: 1,
            max: 100,
          }),
          offset: parseOptionalNumberInput(rest.offset, 'Offset', { integer: true, min: 0 }),
          totalResults: parseOptionalBooleanInput(rest.totalResults),
        }
      },
    },
  },
  inputs: {
    receivablesInvoiceId: {
      type: 'string',
      description: 'Receivables Invoice Id',
    },
    businessUnit: {
      type: 'string',
      description: 'Business Unit',
    },
    transactionNumber: {
      type: 'string',
      description: 'Transaction Number',
    },
    transactionDate: {
      type: 'string',
      description: 'Transaction Date (YYYY-MM-DD)',
    },
    accountingDate: {
      type: 'string',
      description: 'Accounting Date (YYYY-MM-DD)',
    },
    billToCustomerName: {
      type: 'string',
      description: 'Bill To Customer Name',
    },
    billToCustomerNumber: {
      type: 'string',
      description: 'Bill To Customer Number',
    },
    billToSite: {
      type: 'string',
      description: 'Bill To Site',
    },
    invoiceCurrencyCode: {
      type: 'string',
      description: 'Invoice Currency Code',
    },
    invoiceStatus: {
      type: 'string',
      description: 'Invoice Status',
    },
    paymentTerms: {
      type: 'string',
      description: 'Payment Terms',
    },
    transactionSource: {
      type: 'string',
      description: 'Transaction Source',
    },
    transactionType: {
      type: 'string',
      description: 'Transaction Type',
    },
    comments: {
      type: 'string',
      description: 'Comments',
    },
    purchaseOrder: {
      type: 'string',
      description: 'Purchase Order',
    },
    conversionRateType: {
      type: 'string',
      description: 'Conversion Rate Type',
    },
    conversionRate: {
      type: 'number',
      description: 'Conversion Rate',
    },
    conversionDate: {
      type: 'string',
      description: 'Conversion Date (YYYY-MM-DD)',
    },
    lines: {
      type: 'json',
      description:
        'Typed lines to create with the receivables invoice (at most 1000). Use Oracle attribute names; exact integer attributes must be strings.',
    },
    distributions: {
      type: 'json',
      description:
        'Typed distributions to create with the receivables invoice (at most 1000). Use Oracle attribute names; exact integer attributes must be strings.',
    },
    comment: {
      type: 'string',
      description: 'Note recorded in the approval audit history',
    },
    receivablesInvoiceLineId: {
      type: 'string',
      description: 'Receivables Invoice Line Id',
    },
    lineNumber: {
      type: 'number',
      description: 'Line Number',
    },
    description: {
      type: 'string',
      description: 'Description',
    },
    itemNumber: {
      type: 'string',
      description: 'Item Number',
    },
    memoLine: {
      type: 'string',
      description: 'Memo Line',
    },
    lineAmount: {
      type: 'number',
      description: 'Line Amount',
    },
    quantity: {
      type: 'number',
      description: 'Quantity',
    },
    unitSellingPrice: {
      type: 'number',
      description: 'Unit Selling Price',
    },
    unitOfMeasure: {
      type: 'string',
      description: 'Unit Of Measure',
    },
    accountingRule: {
      type: 'string',
      description: 'Accounting Rule',
    },
    accountingRuleDuration: {
      type: 'string',
      description: 'Accounting Rule Duration as an exact decimal string',
    },
    ruleStartDate: {
      type: 'string',
      description: 'Rule Start Date (YYYY-MM-DD)',
    },
    ruleEndDate: {
      type: 'string',
      description: 'Rule End Date (YYYY-MM-DD)',
    },
    taxClassificationCode: {
      type: 'string',
      description: 'Tax Classification Code',
    },
    salesOrder: {
      type: 'string',
      description: 'Sales Order',
    },
    receivablesInvoiceDistributionId: {
      type: 'string',
      description: 'Receivables Invoice Distribution Id',
    },
    accountClass: {
      type: 'string',
      description: 'Account Class',
    },
    accountCombination: {
      type: 'string',
      description: 'Account Combination',
    },
    accountedAmount: {
      type: 'number',
      description: 'Accounted Amount',
    },
    amount: {
      type: 'number',
      description: 'Amount',
    },
    invoiceLineNumber: {
      type: 'number',
      description: 'Invoice Line Number',
    },
    detailedTaxLineNumber: {
      type: 'number',
      description: 'Detailed Tax Line Number',
    },
    percent: {
      type: 'number',
      description: 'Percent',
    },
    receivablesInvoiceInstallmentId: {
      type: 'string',
      description: 'Receivables Invoice Installment Id',
    },
    installmentDueDate: {
      type: 'string',
      description: 'Installment Due Date (YYYY-MM-DD)',
    },
    originalAmount: {
      type: 'number',
      description: 'Original Amount',
    },
    receivablesCreditMemoId: {
      type: 'string',
      description: 'Receivables Credit Memo Id',
    },
    creditMemoCurrency: {
      type: 'string',
      description: 'Credit Memo Currency',
    },
    creditMemoStatus: {
      type: 'string',
      description: 'Credit Memo Status',
    },
    creditReason: {
      type: 'string',
      description: 'Credit Reason',
    },
    freightCreditAmount: {
      type: 'string',
      description: 'Freight Credit Amount',
    },
    creditMemoComments: {
      type: 'string',
      description: 'Credit Memo Comments',
    },
    conversionRateDate: {
      type: 'string',
      description: 'Conversion Rate Date (YYYY-MM-DD)',
    },
    allowCompletion: {
      type: 'string',
      description: 'Allow Completion',
    },
    controlCompletionReason: {
      type: 'string',
      description: 'Control Completion Reason',
    },
    recipientEmail: {
      type: 'string',
      description: 'Recipient Email',
    },
    receivablesCreditMemoLineId: {
      type: 'string',
      description: 'Receivables Credit Memo Line Id',
    },
    lineDescription: {
      type: 'string',
      description: 'Line Description',
    },
    lineAmountCredit: {
      type: 'number',
      description: 'Line Amount Credit',
    },
    lineQuantityCredit: {
      type: 'number',
      description: 'Line Quantity Credit',
    },
    lineCreditReason: {
      type: 'string',
      description: 'Line Credit Reason',
    },
    lineFreightCreditAmount: {
      type: 'number',
      description: 'Line Freight Credit Amount',
    },
    receivablesCreditMemoDistributionId: {
      type: 'string',
      description: 'Receivables Credit Memo Distribution Id',
    },
    creditMemoLineNumber: {
      type: 'number',
      description: 'Credit Memo Line Number',
    },
    receivablesReceiptId: {
      type: 'string',
      description: 'Receivables Receipt Id',
    },
    currency: {
      type: 'string',
      description: 'Currency',
    },
    receiptDate: {
      type: 'string',
      description: 'Receipt Date (YYYY-MM-DD)',
    },
    receiptMethod: {
      type: 'string',
      description: 'Receipt Method',
    },
    receiptNumber: {
      type: 'string',
      description: 'Receipt Number',
    },
    customerAccountNumber: {
      type: 'string',
      description: 'Customer Account Number',
    },
    customerName: {
      type: 'string',
      description: 'Customer Name',
    },
    customerSite: {
      type: 'string',
      description: 'Customer Site',
    },
    maturityDate: {
      type: 'string',
      description: 'Maturity Date (YYYY-MM-DD)',
    },
    structuredPaymentReference: {
      type: 'string',
      description: 'Structured Payment Reference',
    },
    appliedPaymentScheduleId: {
      type: 'string',
      description: 'Invoice installment identifier as an exact decimal string',
    },
    amountApplied: {
      type: 'number',
      description: 'Amount to apply; omitted means the full open transaction balance',
    },
    calledFrom: {
      type: 'string',
      description: 'Caller or process name recorded for audit',
    },
    receivablesCustomerAccountId: {
      type: 'string',
      description: 'Receivables Customer Account Id',
    },
    receivablesCustomerAccountSiteId: {
      type: 'string',
      description: 'Receivables Customer Account Site Id',
    },
    receivablesReceiptApplicationId: {
      type: 'string',
      description: 'Receivables Receipt Application Id',
    },
    receivablesCreditMemoApplicationId: {
      type: 'string',
      description: 'Receivables Credit Memo Application Id',
    },
    receivablesTransactionPaymentScheduleId: {
      type: 'string',
      description: 'Receivables Transaction Payment Schedule Id',
    },
    receivablesTransactionAdjustmentId: {
      type: 'string',
      description: 'Receivables Transaction Adjustment Id',
    },
    expenseReportUniqId: {
      type: 'string',
      description: 'Expense Report Uniq Id',
    },
    orgId: {
      type: 'string',
      description: 'Org Id as an exact integer string',
    },
    personId: {
      type: 'string',
      description: 'Person Id as an exact integer string',
    },
    assignmentId: {
      type: 'string',
      description: 'Assignment Id as an exact integer string',
    },
    preparerId: {
      type: 'string',
      description: 'Preparer Id as an exact integer string',
    },
    purpose: {
      type: 'string',
      description: 'Purpose',
    },
    expenseReportNumber: {
      type: 'string',
      description: 'Expense Report Number',
    },
    expenseReportDate: {
      type: 'string',
      description: 'Expense Report Date (YYYY-MM-DD)',
    },
    reimbursementCurrencyCode: {
      type: 'string',
      description: 'Reimbursement Currency Code',
    },
    exchangeRateType: {
      type: 'string',
      description: 'Exchange Rate Type',
    },
    paymentMethodCode: {
      type: 'string',
      description: 'Payment Method Code',
    },
    overrideApproverId: {
      type: 'string',
      description: 'Override Approver Id as an exact integer string',
    },
    unappliedAdvancesJust: {
      type: 'string',
      description: 'Unapplied Advances Just',
    },
    unappliedCashAdvReason: {
      type: 'string',
      description: 'Unapplied Cash Adv Reason',
    },
    cashAdvanceNumber: {
      type: 'string',
      description: 'Number of the specific cash advance to remove',
    },
    expenseLineUniqId: {
      type: 'string',
      description: 'Expense Line Uniq Id',
    },
    ticketClass: {
      type: 'string',
      description: 'Ticket Class',
    },
    expenseTypeId: {
      type: 'string',
      description: 'Expense Type Id as an exact integer string',
    },
    expenseTemplateId: {
      type: 'string',
      description: 'Expense Template Id as an exact integer string',
    },
    justification: {
      type: 'string',
      description: 'Justification',
    },
    receiptAmount: {
      type: 'number',
      description: 'Receipt Amount',
    },
    receiptCurrencyCode: {
      type: 'string',
      description: 'Receipt Currency Code',
    },
    merchantName: {
      type: 'string',
      description: 'Merchant Name',
    },
    startDate: {
      type: 'string',
      description: 'Start Date (YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      description: 'End Date',
    },
    exchangeRate: {
      type: 'number',
      description: 'Exchange Rate',
    },
    itemizationParentExpenseId: {
      type: 'string',
      description: 'Itemization Parent Expense Id as an exact integer string',
    },
    receiptMissingFlag: {
      type: 'boolean',
      description: 'Receipt Missing Flag',
    },
    location: {
      type: 'string',
      description: 'Location',
    },
    countryCode: {
      type: 'string',
      description: 'Country Code',
    },
    expenseCategoryCode: {
      type: 'string',
      description: 'Expense Category Code',
    },
    expenseSource: {
      type: 'string',
      description: 'Expense Source',
    },
    numberOfDays: {
      type: 'number',
      description: 'Number Of Days',
    },
    numberOfAttendees: {
      type: 'number',
      description: 'Number Of Attendees',
    },
    tripDistance: {
      type: 'number',
      description: 'Trip Distance',
    },
    distanceUnitCode: {
      type: 'string',
      description: 'Distance Unit Code',
    },
    ticketClassCode: {
      type: 'string',
      description: 'Ticket Class Code',
    },
    ticketNumber: {
      type: 'string',
      description: 'Ticket Number',
    },
    expenseDistributionId: {
      type: 'string',
      description: 'Expense Distribution Id',
    },
    expenseId: {
      type: 'string',
      description: 'Expense Id as an exact integer string',
    },
    codeCombinationId: {
      type: 'string',
      description: 'Code Combination Id as an exact integer string',
    },
    company: {
      type: 'string',
      description: 'Company',
    },
    costCenter: {
      type: 'string',
      description: 'Cost Center',
    },
    reimbursableAmount: {
      type: 'number',
      description: 'Reimbursable Amount',
    },
    expenseItemizationId: {
      type: 'string',
      description: 'Expense Itemization Id',
    },
    expenseReportProcessingDetailUniqId: {
      type: 'string',
      description: 'Expense Report Processing Detail Uniq Id',
    },
    expenseReportPaymentId: {
      type: 'string',
      description: 'Expense Report Payment Id',
    },
    expenseLineErrorSequence: {
      type: 'string',
      description: 'Expense Line Error Sequence',
    },
    glLedgerId: {
      type: 'string',
      description: 'Gl Ledger Id',
    },
    glJournalBatchId: {
      type: 'string',
      description: 'Gl Journal Batch Id',
    },
    glJournalHeaderUniqId: {
      type: 'string',
      description: 'Gl Journal Header Uniq Id',
    },
    glJournalLineUniqId: {
      type: 'string',
      description: 'Gl Journal Line Uniq Id',
    },
    glJournalErrorUniqId: {
      type: 'string',
      description: 'Gl Journal Error Uniq Id',
    },
    glJournalActionLogUniqId: {
      type: 'string',
      description: 'Gl Journal Action Log Uniq Id',
    },
    operation: { type: 'string', description: 'Oracle Fusion Financials operation to perform' },
    oauthCredential: {
      type: 'string',
      description: 'Oracle Fusion service-account credential',
    },
    invoiceUniqId: {
      type: 'string',
      description: 'Opaque invoice key returned by Oracle Fusion',
    },
    invoiceLineUniqId: {
      type: 'string',
      description: 'Opaque invoice-line key returned by Oracle Fusion',
    },
    invoiceInstallmentUniqId: {
      type: 'string',
      description: 'Opaque invoice-installment key returned by Oracle Fusion',
    },
    invoiceDistributionId: {
      type: 'string',
      description: 'Oracle InvoiceDistributionId as a decimal string',
    },
    appliedPrepaymentUniqId: {
      type: 'string',
      description: 'Opaque applied-prepayment key returned by Oracle Fusion',
    },
    availablePrepaymentUniqId: {
      type: 'string',
      description: 'Opaque available-prepayment key returned by Oracle Fusion',
    },
    checkId: { type: 'string', description: 'Oracle payment CheckId as a decimal string' },
    invoicePaymentId: {
      type: 'string',
      description: 'Oracle InvoicePaymentId as a decimal string',
    },
    paymentProcessRequestId: {
      type: 'string',
      description: 'Oracle PaymentProcessRequestId as a decimal string',
    },
    holdId: { type: 'string', description: 'Oracle HoldId as a decimal string' },
    termsId: { type: 'string', description: 'Oracle termsId as a decimal string' },
    paymentTermLineUniqId: {
      type: 'string',
      description: 'Opaque payment-term-line key returned by Oracle Fusion',
    },
    q: { type: 'string', description: 'Oracle REST Framework q filter expression' },
    finder: { type: 'string', description: 'Oracle predefined finder expression' },
    orderBy: { type: 'string', description: 'Oracle attribute ordering expression' },
    effectiveDate: { type: 'string', description: 'Invoice effective date in YYYY-MM-DD form' },
    limit: { type: 'number', description: 'Page size from 1 to 100' },
    offset: { type: 'number', description: 'Non-negative page offset' },
    totalResults: { type: 'boolean', description: 'Request Oracle total-results metadata' },
  },
  outputs: {
    receivablesInvoice: {
      type: 'json',
      description: 'Projected receivables invoice',
    },
    receivablesInvoiceLine: {
      type: 'json',
      description: 'Projected receivables invoice line',
    },
    receivablesInvoiceDistribution: {
      type: 'json',
      description: 'Projected receivables invoice distribution',
    },
    receivablesInvoiceInstallment: {
      type: 'json',
      description: 'Projected receivables invoice installment',
    },
    receivablesCreditMemo: {
      type: 'json',
      description: 'Projected receivables credit memo',
    },
    receivablesCreditMemoLine: {
      type: 'json',
      description: 'Projected receivables credit memo line',
    },
    receivablesCreditMemoDistribution: {
      type: 'json',
      description: 'Projected receivables credit memo distribution',
    },
    receivablesReceipt: {
      type: 'json',
      description: 'Projected receivables receipt',
    },
    receivablesCustomerAccount: {
      type: 'json',
      description: 'Projected receivables customer account',
    },
    receivablesCustomerAccountSite: {
      type: 'json',
      description: 'Projected receivables customer account site',
    },
    receivablesReceiptApplication: {
      type: 'json',
      description: 'Projected receivables receipt application',
    },
    receivablesCreditMemoApplication: {
      type: 'json',
      description: 'Projected receivables credit memo application',
    },
    receivablesTransactionPaymentSchedule: {
      type: 'json',
      description: 'Projected receivables transaction payment schedule',
    },
    receivablesTransactionAdjustment: {
      type: 'json',
      description: 'Projected receivables transaction adjustment',
    },
    expenseReport: {
      type: 'json',
      description: 'Projected expense report',
    },
    expenseLine: {
      type: 'json',
      description: 'Projected expense line',
    },
    expenseDistribution: {
      type: 'json',
      description: 'Projected expense distribution',
    },
    expenseItemization: {
      type: 'json',
      description: 'Projected expense itemization',
    },
    expenseReportProcessingDetail: {
      type: 'json',
      description: 'Projected expense report processing detail',
    },
    expenseReportPayment: {
      type: 'json',
      description: 'Projected expense report payment',
    },
    expenseLineError: {
      type: 'json',
      description: 'Projected expense line error',
    },
    glLedger: {
      type: 'json',
      description: 'Projected gl ledger',
    },
    glJournalBatch: {
      type: 'json',
      description: 'Projected gl journal batch',
    },
    glJournalHeader: {
      type: 'json',
      description: 'Projected gl journal header',
    },
    glJournalLine: {
      type: 'json',
      description: 'Projected gl journal line',
    },
    glJournalError: {
      type: 'json',
      description: 'Projected gl journal error',
    },
    glJournalActionLog: {
      type: 'json',
      description: 'Projected gl journal action log',
    },
    result: { type: 'string', description: 'Documented Oracle lifecycle action result' },
    deleted: { type: 'boolean', description: 'Whether the requested deletion succeeded' },
    id: { type: 'string', description: 'Identifier of the deleted resource' },
    items: {
      type: 'array',
      description: 'Projected Oracle Fusion Financials resources in this page',
    },
    count: { type: 'number', description: 'Number of records in this page' },
    hasMore: { type: 'boolean', description: 'Whether Oracle has another page' },
    limit: { type: 'number', description: 'Page size returned by Oracle' },
    offset: { type: 'number', description: 'Offset returned by Oracle' },
    totalResults: {
      type: 'number',
      description: 'Estimated total matching records when requested',
    },
    invoice: {
      type: 'json',
      description:
        'Projected Payables invoice with an invoiceUniqId string and nullable number/string scalars for identity, supplier and site, business unit, amount and currency, invoice and accounting dates, payment and workflow statuses, terms, method, purchase order, description, and creation/update dates',
    },
    payment: {
      type: 'json',
      description:
        'Projected Payables payment with nullable number, string, and boolean scalars for check/payment identity, reference, amount and currency, payment/accounting dates, payee and supplier, method/status/type, business unit, legal entity, reconciliation flag, and creation/update dates',
    },
    invoiceLine: {
      type: 'json',
      description:
        'Projected invoice line with its Oracle-derived opaque key, amounts, accounting flags, purchase-order and receipt references, item, tax, location, and timestamps',
    },
    invoiceInstallment: {
      type: 'json',
      description:
        'Projected invoice installment with its Oracle-derived opaque key, due and unpaid amounts, payment method and priority, hold state, discounts, and timestamps',
    },
    invoiceDistribution: {
      type: 'json',
      description:
        'Projected invoice distribution with identity, amounts, account combination, accounting, match and funds status, reversal and cancellation flags, document references, tax, asset state, and timestamps',
    },
    appliedPrepayment: {
      type: 'json',
      description:
        'Projected applied prepayment with its Oracle-derived opaque key, invoice and line identity, supplier site, currency, amount, tax, application date, and inclusion flag',
    },
    availablePrepayment: {
      type: 'json',
      description:
        'Projected available prepayment with its Oracle-derived opaque key, invoice and line identity, supplier site, currency, available amount, and tax',
    },
    paymentRelatedInvoice: {
      type: 'json',
      description:
        'Projected invoice related to a payment with payment, invoice and installment identity, business unit, currencies, amounts, discounts, exchange rate, status, and timestamps',
    },
    invoiceHold: {
      type: 'json',
      description:
        'Projected Payables invoice hold with invoice, supplier and business-unit context, hold and release details, workflow state, document references, and timestamps',
    },
    paymentProcessRequest: {
      type: 'json',
      description:
        'Projected payment process request with identifier, name, source application, status code, and status meaning',
    },
    paymentTerm: {
      type: 'json',
      description:
        'Projected Payables payment term with identity, name, description, enabled and effective state, cutoff, ranking, reference set, and timestamps',
    },
    paymentTermLine: {
      type: 'json',
      description:
        'Projected payment-term calculation line with its Oracle-derived opaque key, due-date calculation values, and three discount tiers',
    },
  },
}

export const OracleFusionFinancialsBlockMeta = {
  tags: ['automation', 'data-analytics', 'payments'],
  url: 'https://www.oracle.com/erp/financials/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Investigate journal exceptions',
      prompt:
        'Review a bounded page of Oracle Fusion journal batches and read the errors, action logs, headers, and lines for selected batches. Preserve opaque journal keys and summarize posting exceptions without attempting to post or approve journals.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'audit'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review ledger account balances',
      prompt:
        'Select an accessible Oracle Fusion ledger and use the documented account balance finder for an explicit accounting period, account combination, and currency. Report returned balance strings and missing-value markers faithfully, without treating missing data as zero.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review expense submission exceptions',
      prompt:
        'Build a workflow that lists a bounded page of Oracle Fusion expense reports, reads expense-line validation errors and report processing details for selected reports, and summarizes the issues. Keep Oracle-derived opaque keys and do not assume the service account can access other employees.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'audit'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Prepare and submit an expense report',
      prompt:
        'Create an Oracle Fusion expense workflow using explicitly provided organization, person, assignment, ticket class, and expense values. Create the report and its lines, inspect validation messages, then submit the selected report when requested. Treat result S as successful submission and report error-bearing results without retrying the write.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'expenses'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review receivables aging',
      prompt:
        'Build a workflow that reads a bounded page of Oracle Fusion Receivables customer account activity, lists transaction payment schedules for selected accounts, and reports overdue balances without assuming estimated totals are exact.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Apply a customer receipt',
      prompt:
        'Build a workflow with explicit receipt and invoice inputs. Look up the Receivables invoice installments, preserve the selected InstallmentId as an exact string, apply the specified amount from the selected standard receipt, and report the documented action result. Do not infer success from HTTP status alone.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'payments'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Investigate credit memo applications',
      prompt:
        'Create a workflow that reads a Receivables credit memo and its lines and distributions, then reviews credit memo applications for the selected customer account. Report the application references and amounts without creating a replacement transaction.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'audit'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Find overdue Payables invoices',
      prompt:
        'Build a scheduled workflow that lists unpaid Oracle Fusion Payables invoices, reviews their installments for due dates before today, and sends a concise overdue-invoice report without fetching additional pages automatically.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Report unpaid invoice aging',
      prompt:
        'Create a workflow that reads one bounded page of unpaid Oracle Fusion Payables invoices, groups amounts into aging buckets from invoice and installment dates, and writes the summary to a table.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor invoice approval exceptions',
      prompt:
        'Build a scheduled Oracle Fusion workflow that lists Payables invoices with exceptional approval status and sends finance a report containing invoice number, supplier, amount, currency, and status.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor invoice validation exceptions',
      prompt:
        'Build a scheduled workflow that lists Oracle Fusion Payables invoices with validation exceptions and records their identifiers, suppliers, amounts, and validation status for investigation.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Audit Payables invoice lines',
      prompt:
        'Create a workflow that selects an Oracle Fusion Payables invoice, reads its invoice lines and accounting distributions, and reports line amounts, account combinations, match and funds status, purchase-order and receipt references, tax, and reversal state.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'audit'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Track upcoming payment installments',
      prompt:
        'Create a scheduled workflow that reviews Oracle Fusion Payables invoice installments due in the coming week, reads payment term calculation lines when the termsId is known, and sends a treasury digest with unpaid amount, due date, discounts, payment method, priority, and hold state.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['finance', 'payments'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Reconcile recent Payables payments',
      prompt:
        'Build a scheduled workflow that lists one page of recent Oracle Fusion Payables payments, traces each selected payment to its related invoices, checks a payment process request when its identifier is known, and writes a reconciliation report with identifiers, dates, amounts, and status.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'payments'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Create a supplier payment report',
      prompt:
        'Create a workflow that lists Oracle Fusion Payables payments for a specified reporting period and produces a supplier-level report using payee, supplier number, amount, currency, method, status, and payment date.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Investigate Payables invoice holds',
      prompt:
        'Build a workflow that lists active Oracle Fusion Payables invoice holds, reads selected hold details, and produces an investigation queue with supplier, invoice, hold reason, workflow status, purchase-order or receipt context, and release history.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'audit'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Analyze invoice prepayment coverage',
      prompt:
        'Create a workflow that selects a Payables invoice, compares its applied and available prepayments, and reports currency, applied or available amounts, included tax, supplier site, and application date without applying or unapplying anything.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'payments'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor payment process requests',
      prompt:
        'Create a scheduled workflow that lists recent Oracle Fusion payment process requests, highlights incomplete or exceptional status codes, and sends treasury a concise payment-run status report.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Analyze terms-based payment schedules',
      prompt:
        'Build a workflow that reads a Payables payment term and its calculation lines, compares due-date and three-tier discount rules with a selected invoice installment, and reports schedule discrepancies for review.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'audit'],
    },
  ],
  skills: [
    {
      name: 'review-general-ledger-exceptions',
      description:
        'Investigate journal errors and review account balances within authorized ledgers.',
      content: `# Review General Ledger Exceptions

## Steps
1. List accessible ledgers and select the intended ledger.
2. List one bounded page of journal batches using documented filters.
3. Inspect errors, action logs, headers, and lines for selected batches, retaining Oracle self-link keys.
4. Query balances with the documented ledger, account, period, and currency finder inputs.

## Output
Summarize journal exceptions and returned balances. Preserve missing-value markers; do not infer zero balances, post journals, or orchestrate imports. Respect Oracle ledger and data-access-set permissions.`,
    },
    {
      name: 'review-oracle-fusion-expense-report',
      description: 'Inspect report and line validation before a requested expense submission.',
      content:
        '# Review an Expense Report\n\n## Steps\n\n1. Select a report using its Oracle-derived opaque key, not ExpenseReportId.\n2. Read the report, a bounded page of expense lines, and relevant line errors.\n3. Review validation messages and missing receipt requirements.\n4. Only when submission is requested, use Submit Expense Report.\n\n## Output\n\nReport validation findings and the documented submission result. S means no submission errors, while 1:<expenseReportNumber> is an error-bearing result.',
    },
    {
      name: 'apply-oracle-fusion-receivables-receipt',
      description:
        'Apply an explicitly selected standard receipt to a verified invoice installment.',
      content:
        '# Apply a Receivables Receipt\n\n## Steps\n\n1. Read the selected Receivables invoice and list its installments.\n2. Keep CustomerTransactionId and InstallmentId as exact strings; do not use display invoice numbers as IDs.\n3. Apply the selected standard receipt to the chosen installment with the requested amount. Do not retry writes automatically.\n\n## Output\n\nReport the action result; only SUCCESS means application succeeded.',
    },
    {
      name: 'find-unpaid-oracle-fusion-invoices',
      description: 'Find unpaid Oracle Fusion Payables invoices in a bounded result page.',
      content:
        '# Find Unpaid Oracle Fusion Invoices\n\n## Steps\n\n1. Use List Payables Invoices with the narrowest verified q filter for unpaid status.\n2. Request only one page, with limit no greater than 100.\n3. Use the returned invoiceUniqId when a specific invoice needs more detail.\n\n## Output\n\nReturn invoice number, supplier, amount, currency, invoice date, paid status, and whether Oracle reports another page.',
    },
    {
      name: 'inspect-oracle-fusion-invoice-lines',
      description: 'Inspect the fixed, read-only line projection for a Payables invoice.',
      content:
        '# Inspect Oracle Fusion Invoice Lines\n\n## Steps\n\n1. Select the invoice or use an invoiceUniqId returned by Oracle.\n2. Use List Payables Invoice Lines with a page limit no greater than 100.\n3. Review amounts, accounting flags, purchase-order and receipt references, item fields, tax fields, and locations.\n\n## Output\n\nReport the invoice key, relevant line numbers, findings, and whether another page remains.',
    },
    {
      name: 'audit-oracle-fusion-invoice-distributions',
      description: 'Audit accounting distributions and matching state for a Payables invoice line.',
      content:
        '# Audit Oracle Fusion Invoice Distributions\n\n## Steps\n\n1. Select an invoice and list its invoice lines to obtain an Oracle-derived invoiceLineUniqId.\n2. Use List Payables Invoice Distributions with a page limit no greater than 100.\n3. Review account combinations, amounts, accounting, match and funds status, reversal and cancellation flags, and purchase-order, receipt, prepayment, tax, and asset references.\n4. Use Get Payables Invoice Distribution with the decimal InvoiceDistributionId for one selected record.\n\n## Output\n\nReport the invoice and line keys, distribution identifiers, accounting exceptions, and whether another page remains.',
    },
    {
      name: 'review-oracle-fusion-payment-schedules',
      description: 'Review due dates, unpaid amounts, discounts, and holds for an invoice.',
      content:
        '# Review Oracle Fusion Payment Schedules\n\n## Steps\n\n1. Select the invoice or provide its Oracle-derived opaque key.\n2. Use List Payables Invoice Installments for one bounded page and Get Payables Invoice Installment when one schedule needs detail.\n3. Read the applicable Payables Payment Term and its term lines when the termsId is known.\n4. Compare due date, unpaid amount, payment priority, hold state, discount dates and amounts, and the documented due and discount calculation values.\n\n## Output\n\nSummarize upcoming obligations and any schedule discrepancy without guessing unavailable term mappings.',
    },
    {
      name: 'trace-oracle-fusion-invoice-payment-status',
      description: 'Trace the read-only payment state exposed on a Payables invoice.',
      content:
        '# Trace Oracle Fusion Invoice Payment Status\n\n## Steps\n\n1. Use Get Payables Invoice with an invoiceUniqId obtained from Oracle.\n2. Review amount, amount paid, paid status, approval status, validation status, method, and terms.\n3. If schedule timing matters, list the invoice installments separately.\n\n## Output\n\nState the invoice payment state and supporting fields; do not infer a payment-to-invoice link that Oracle did not return.',
    },
    {
      name: 'reconcile-recent-oracle-fusion-payments',
      description: 'Review recent Payables payments and isolate reconciliation exceptions.',
      content:
        '# Reconcile Recent Oracle Fusion Payments\n\n## Steps\n\n1. Use List Payables Payments ordered by PaymentDate descending with one bounded page.\n2. Review CheckId, payment references, amount, currency, date, status, and ReconciledFlag.\n3. For selected payments, list related invoices and inspect the relevant payment process request when its identifier is known.\n4. Use Get Payables Payment or Get Payment-Related Invoice for a specific record.\n\n## Output\n\nReport reconciled and unreconciled payments, related invoice amounts and discounts, payment-run status, and whether another page remains.',
    },
    {
      name: 'investigate-oracle-fusion-invoice-holds',
      description: 'Investigate Payables invoice holds and their release workflow state.',
      content:
        '# Investigate Oracle Fusion Invoice Holds\n\n## Steps\n\n1. Use List Payables Invoice Holds with the narrowest documented q filter and a page limit no greater than 100.\n2. Review invoice, supplier, business unit, line, hold reason, workflow status, purchase-order, and receipt context.\n3. Use Get Payables Invoice Hold with the decimal HoldId to inspect release details and timestamps.\n\n## Output\n\nReturn a prioritized hold queue with evidence from Oracle and state whether another page remains.',
    },
    {
      name: 'trace-oracle-fusion-payment-applications',
      description: 'Trace a Payables payment to invoices and prepayment activity.',
      content:
        '# Trace Oracle Fusion Payment Applications\n\n## Steps\n\n1. Use Get Payables Payment with its decimal CheckId.\n2. Use List Payment-Related Invoices for that payment and inspect selected InvoicePaymentId records.\n3. For a selected invoice, compare applied and available prepayments using only Oracle-derived opaque keys.\n4. Review invoice and payment currencies, paid amounts, discounts, exchange rate, payment status, and application accounting date.\n\n## Output\n\nProvide a read-only trace from payment to invoice applications and clearly identify any pagination boundary or unavailable linkage.',
    },
  ],
} as const satisfies BlockMeta
