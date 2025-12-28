import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { account } from './schema'
import { user } from './schema'
import { workspace } from './schema'

/**
 * Financial Sync Schemas for QuickBooks and Plaid integration
 */

// Plaid connection status enum
export const plaidConnectionStatusEnum = pgEnum('plaid_connection_status', [
  'active',
  'requires_update',
  'error',
  'disconnected',
])

// QuickBooks sync status enum
export const quickbooksSyncStatusEnum = pgEnum('quickbooks_sync_status', [
  'idle',
  'syncing',
  'completed',
  'error',
])

// Transaction reconciliation status enum
export const reconciliationStatusEnum = pgEnum('reconciliation_status', [
  'pending',
  'matched',
  'unmatched',
  'ignored',
])

/**
 * Plaid Connections table
 * Stores Plaid access tokens and connection metadata
 */
export const plaidConnections = pgTable(
  'plaid_connections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),

    // Plaid-specific fields
    itemId: text('item_id').notNull(), // Plaid item ID
    accessToken: text('access_token').notNull(), // Encrypted Plaid access token
    institutionId: text('institution_id').notNull(), // Financial institution ID
    institutionName: text('institution_name').notNull(),

    // Connection metadata
    accountIds: jsonb('account_ids').notNull(), // Array of Plaid account IDs
    availableProducts: jsonb('available_products').notNull(), // Array of products
    status: plaidConnectionStatusEnum('status').notNull().default('active'),

    // Sync tracking
    lastSuccessfulSync: timestamp('last_successful_sync'),
    lastSyncAttempt: timestamp('last_sync_attempt'),
    syncErrorMessage: text('sync_error_message'),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('plaid_connections_user_id_idx').on(table.userId),
    workspaceIdIdx: index('plaid_connections_workspace_id_idx').on(table.workspaceId),
    itemIdIdx: uniqueIndex('plaid_connections_item_id_idx').on(table.itemId),
    statusIdx: index('plaid_connections_status_idx').on(table.status),
  })
)

/**
 * QuickBooks Sync State table
 * Tracks synchronization state for QuickBooks entities
 */
export const quickbooksSyncState = pgTable(
  'quickbooks_sync_state',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),

    // QuickBooks connection
    realmId: text('realm_id').notNull(), // QuickBooks company ID
    accountId: text('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }), // Links to OAuth account

    // Sync configuration
    syncInvoices: boolean('sync_invoices').notNull().default(true),
    syncCustomers: boolean('sync_customers').notNull().default(true),
    syncExpenses: boolean('sync_expenses').notNull().default(true),
    syncPayments: boolean('sync_payments').notNull().default(true),

    // Last sync timestamps per entity type
    lastInvoiceSync: timestamp('last_invoice_sync'),
    lastCustomerSync: timestamp('last_customer_sync'),
    lastExpenseSync: timestamp('last_expense_sync'),
    lastPaymentSync: timestamp('last_payment_sync'),

    // Sync status
    status: quickbooksSyncStatusEnum('status').notNull().default('idle'),
    errorMessage: text('error_message'),

    // Sync statistics
    totalInvoicesSynced: jsonb('total_invoices_synced').default('0'),
    totalCustomersSynced: jsonb('total_customers_synced').default('0'),
    totalExpensesSynced: jsonb('total_expenses_synced').default('0'),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('quickbooks_sync_state_user_id_idx').on(table.userId),
    workspaceIdIdx: index('quickbooks_sync_state_workspace_id_idx').on(table.workspaceId),
    realmIdIdx: uniqueIndex('quickbooks_sync_state_realm_id_idx').on(table.realmId),
    statusIdx: index('quickbooks_sync_state_status_idx').on(table.status),
  })
)

/**
 * Financial Transactions table
 * Unified table for all financial transactions (from Plaid, QuickBooks, etc.)
 */
export const financialTransactions = pgTable(
  'financial_transactions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),

    // Transaction source
    source: text('source').notNull(), // 'plaid', 'quickbooks', 'manual'
    externalId: text('external_id').notNull(), // ID from the source system

    // Transaction details
    amount: jsonb('amount').notNull(), // { value: number, currency: string }
    date: timestamp('date').notNull(),
    description: text('description').notNull(),
    merchantName: text('merchant_name'),

    // Categorization
    category: text('category'), // e.g., 'Travel', 'Office Supplies'
    subcategory: text('subcategory'),
    tags: jsonb('tags'), // Array of custom tags

    // Account information
    accountId: text('account_id'), // Plaid account ID or QuickBooks account ref
    accountName: text('account_name'),

    // Reconciliation
    reconciliationStatus: reconciliationStatusEnum('reconciliation_status')
      .notNull()
      .default('pending'),
    matchedTransactionId: text('matched_transaction_id'), // Link to matched transaction
    quickbooksInvoiceId: text('quickbooks_invoice_id'), // Link to QuickBooks invoice
    quickbooksExpenseId: text('quickbooks_expense_id'), // Link to QuickBooks expense

    // Metadata
    metadata: jsonb('metadata'), // Additional source-specific data

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('financial_transactions_user_id_idx').on(table.userId),
    workspaceIdIdx: index('financial_transactions_workspace_id_idx').on(table.workspaceId),
    sourceExternalIdIdx: uniqueIndex('financial_transactions_source_external_id_idx').on(
      table.source,
      table.externalId
    ),
    dateIdx: index('financial_transactions_date_idx').on(table.date),
    reconciliationStatusIdx: index('financial_transactions_reconciliation_status_idx').on(
      table.reconciliationStatus
    ),
    categoryIdx: index('financial_transactions_category_idx').on(table.category),
  })
)

/**
 * Reconciliation Rules table
 * Auto-categorization and matching rules for transactions
 */
export const reconciliationRules = pgTable(
  'reconciliation_rules',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),

    // Rule configuration
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    priority: jsonb('priority').notNull().default('100'), // Higher priority rules run first

    // Matching conditions
    conditions: jsonb('conditions').notNull(), // Array of conditions to match
    // Example: [{ field: 'merchantName', operator: 'contains', value: 'Uber' }]

    // Actions to perform when matched
    actions: jsonb('actions').notNull(), // Array of actions to take
    // Example: [{ type: 'setCategory', value: 'Travel' }, { type: 'createExpense', ... }]

    // Statistics
    timesApplied: jsonb('times_applied').notNull().default('0'),
    lastApplied: timestamp('last_applied'),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('reconciliation_rules_user_id_idx').on(table.userId),
    workspaceIdIdx: index('reconciliation_rules_workspace_id_idx').on(table.workspaceId),
    isActiveIdx: index('reconciliation_rules_is_active_idx').on(table.isActive),
  })
)

/**
 * Financial Sync Logs table
 * Audit trail for sync operations
 */
export const financialSyncLogs = pgTable(
  'financial_sync_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),

    // Sync details
    syncType: text('sync_type').notNull(), // 'plaid', 'quickbooks'
    operation: text('operation').notNull(), // 'fetch_transactions', 'create_invoice', etc.
    status: text('status').notNull(), // 'success', 'error', 'partial'

    // Results
    itemsProcessed: jsonb('items_processed').notNull().default('0'),
    itemsSucceeded: jsonb('items_succeeded').notNull().default('0'),
    itemsFailed: jsonb('items_failed').notNull().default('0'),

    // Error tracking
    errorMessage: text('error_message'),
    errorDetails: jsonb('error_details'),

    // Performance metrics
    durationMs: jsonb('duration_ms'),

    // Metadata
    metadata: jsonb('metadata'),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('financial_sync_logs_user_id_idx').on(table.userId),
    workspaceIdIdx: index('financial_sync_logs_workspace_id_idx').on(table.workspaceId),
    syncTypeIdx: index('financial_sync_logs_sync_type_idx').on(table.syncType),
    statusIdx: index('financial_sync_logs_status_idx').on(table.status),
    createdAtIdx: index('financial_sync_logs_created_at_idx').on(table.createdAt),
  })
)
