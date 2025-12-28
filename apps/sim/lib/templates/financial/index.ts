/**
 * Financial Automation Workflow Templates
 *
 * This module exports all pre-built financial automation templates
 * for AI-powered workflows in the SIM platform.
 *
 * Templates:
 * 1. Late Invoice Reminder - Automated invoice collection with escalation
 * 2. Expense Approval Workflow - AI categorization with approval gates
 * 3. Stripe→QuickBooks Reconciliation - Payment sync and reconciliation
 * 4. Cash Flow Monitoring - Weekly cash runway analysis and alerts
 * 5. Monthly Financial Report - Comprehensive monthly reporting
 */

import { lateInvoiceReminderTemplate } from './late-invoice-reminder'
import { expenseApprovalWorkflowTemplate } from './expense-approval-workflow'
import { stripeQuickBooksReconciliationTemplate } from './stripe-quickbooks-reconciliation'
import { cashFlowMonitoringTemplate } from './cash-flow-monitoring'
import { monthlyFinancialReportTemplate } from './monthly-financial-report'
import type { TemplateDefinition } from '../types'

/**
 * All financial automation templates
 */
export const financialTemplates: TemplateDefinition[] = [
  lateInvoiceReminderTemplate,
  expenseApprovalWorkflowTemplate,
  stripeQuickBooksReconciliationTemplate,
  cashFlowMonitoringTemplate,
  monthlyFinancialReportTemplate,
]

/**
 * Export individual templates
 */
export {
  lateInvoiceReminderTemplate,
  expenseApprovalWorkflowTemplate,
  stripeQuickBooksReconciliationTemplate,
  cashFlowMonitoringTemplate,
  monthlyFinancialReportTemplate,
}

/**
 * Get template by ID
 */
export const getTemplateById = (id: string): TemplateDefinition | undefined => {
  return financialTemplates.find((template) => template.metadata.id === id)
}

/**
 * Get templates by tag
 */
export const getTemplatesByTag = (tag: string): TemplateDefinition[] => {
  return financialTemplates.filter((template) => template.metadata.tags.includes(tag))
}

/**
 * Get all template IDs
 */
export const getAllTemplateIds = (): string[] => {
  return financialTemplates.map((template) => template.metadata.id)
}
