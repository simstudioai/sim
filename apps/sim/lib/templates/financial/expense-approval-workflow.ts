import type { TemplateDefinition } from '../types'

/**
 * Expense Approval Workflow Automation Template
 *
 * Description:
 * Automatically categorizes expenses from Plaid transactions, requests approval
 * for high-value expenses via Slack, and creates QuickBooks expense entries.
 *
 * Workflow:
 * 1. Trigger: Plaid webhook detects new transaction
 * 2. Agent: AI categorizes expense and extracts details
 * 3. Condition: Check if amount > $500
 * 4. If > $500:
 *    a. Slack: Send approval request with transaction details
 *    b. Human-in-the-Loop: Pause for approval/rejection
 * 5. Condition: Check if approved (or auto-approve if < $500)
 * 6. QuickBooks: Create expense entry with categorization
 * 7. Slack: Confirm expense recorded
 *
 * Required Credentials:
 * - Plaid (banking)
 * - Slack (notifications)
 * - QuickBooks Online (accounting)
 */
export const expenseApprovalWorkflowTemplate: TemplateDefinition = {
  metadata: {
    id: 'expense-approval-workflow-v1',
    name: 'Expense Approval Workflow Automation',
    description:
      'Automatically categorizes expenses, requests approval for high-value items, and syncs to QuickBooks',
    details: `## 💳 Expense Approval Workflow Automation

### What it does

This workflow automates expense management from bank transactions to accounting:

1. **Real-time Detection**: Plaid webhook triggers on new transactions
2. **AI Categorization**: Automatically categorizes expense type and extracts details
3. **Smart Approval**: Requests human approval for expenses over $500
4. **QuickBooks Sync**: Creates properly categorized expense entries
5. **Confirmation**: Sends Slack notification when expense is recorded

### Benefits

- ✅ Eliminate manual expense categorization
- ✅ Enforce approval policies automatically
- ✅ Reduce data entry time by 90%
- ✅ Maintain accurate, real-time financial records
- ✅ Audit trail for all expense approvals

### Customization

- Adjust approval threshold (default: $500)
- Customize expense categories
- Add multi-level approval chains
- Configure notification channels`,
    tags: ['expenses', 'automation', 'approval', 'accounting', 'ai'],
    requiredCredentials: [
      {
        provider: 'plaid',
        service: 'plaid-banking',
        purpose: 'Receive transaction webhooks and fetch transaction details',
        required: true,
      },
      {
        provider: 'slack',
        service: 'slack',
        purpose: 'Send approval requests and confirmations',
        required: true,
      },
      {
        provider: 'quickbooks',
        service: 'quickbooks-accounting',
        purpose: 'Create expense entries in QuickBooks',
        required: true,
      },
    ],
    creatorId: 'sim-official',
    status: 'approved',
  },

  state: {
    blocks: [
      // Block 1: Webhook Trigger (Plaid Transaction Event)
      {
        id: 'webhook-trigger-1',
        type: 'generic_webhook',
        name: 'Plaid Transaction Webhook',
        positionX: 100,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: true,
        height: 140,
        subBlocks: {
          webhookId: {
            id: 'webhookId',
            value: 'plaid-transaction-webhook',
            type: 'short-input',
          },
          description: {
            id: 'description',
            value: 'Receives Plaid DEFAULT_UPDATE webhook for new transactions',
            type: 'long-input',
          },
        },
        outputs: {},
        data: {
          description: 'Triggered when Plaid detects a new transaction',
        },
      },

      // Block 2: Plaid - Get Transaction Details
      {
        id: 'plaid-get-transaction-1',
        type: 'plaid',
        name: 'Get Transaction Details',
        positionX: 400,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 180,
        subBlocks: {
          operation: {
            id: 'operation',
            value: 'get_transactions',
            type: 'dropdown',
          },
          clientId: {
            id: 'clientId',
            value: '{{credentials.plaid.clientId}}',
            type: 'short-input',
            required: true,
          },
          secret: {
            id: 'secret',
            value: '{{credentials.plaid.secret}}',
            type: 'short-input',
            required: true,
          },
          accessToken: {
            id: 'accessToken',
            value: '{{credentials.plaid.accessToken}}',
            type: 'short-input',
            required: true,
          },
          startDate: {
            id: 'startDate',
            value: "{{$now.subtract(1, 'days').format('YYYY-MM-DD')}}",
            type: 'short-input',
            required: true,
          },
          endDate: {
            id: 'endDate',
            value: "{{$now.format('YYYY-MM-DD')}}",
            type: 'short-input',
            required: true,
          },
          count: {
            id: 'count',
            value: '10',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'Fetches recent transaction details from Plaid',
        },
      },

      // Block 3: Agent - AI Expense Categorization
      {
        id: 'agent-categorize-1',
        type: 'agent',
        name: 'Categorize Expense',
        positionX: 700,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 200,
        subBlocks: {
          prompt: {
            id: 'prompt',
            value: `Analyze this transaction and categorize it:

Transaction: {{plaid-get-transaction-1.transactions[0].name}}
Amount: \${{plaid-get-transaction-1.transactions[0].amount}}
Merchant: {{plaid-get-transaction-1.transactions[0].merchant_name}}
Date: {{plaid-get-transaction-1.transactions[0].date}}

Categorize this expense into one of: Travel, Meals & Entertainment, Office Supplies, Software, Utilities, Professional Services, Marketing, Other.

Return a JSON object with:
{
  "category": "category name",
  "subcategory": "specific subcategory",
  "description": "clean description for accounting",
  "isRecurring": true/false,
  "businessPurpose": "likely business purpose"
}`,
            type: 'long-input',
            required: true,
          },
          model: {
            id: 'model',
            value: 'gpt-4',
            type: 'dropdown',
          },
          temperature: {
            id: 'temperature',
            value: '0.3',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'AI categorizes expense and extracts business details',
        },
      },

      // Block 4: Condition - Check Amount Threshold
      {
        id: 'condition-amount-check-1',
        type: 'condition',
        name: 'Amount > $500?',
        positionX: 1000,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 140,
        subBlocks: {
          condition: {
            id: 'condition',
            value: '{{plaid-get-transaction-1.transactions[0].amount}} > 500',
            type: 'code',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Checks if expense requires approval based on amount threshold',
        },
      },

      // Block 5: Slack - Request Approval
      {
        id: 'slack-request-approval-1',
        type: 'slack',
        name: 'Request Approval',
        positionX: 1300,
        positionY: 50,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 200,
        subBlocks: {
          operation: {
            id: 'operation',
            value: 'send_message',
            type: 'dropdown',
          },
          channel: {
            id: 'channel',
            value: '#expense-approvals',
            type: 'short-input',
            required: true,
          },
          text: {
            id: 'text',
            value: `🔔 *Expense Approval Required*

*Transaction Details:*
• Merchant: {{plaid-get-transaction-1.transactions[0].merchant_name}}
• Amount: \${{plaid-get-transaction-1.transactions[0].amount}}
• Date: {{plaid-get-transaction-1.transactions[0].date}}
• Description: {{plaid-get-transaction-1.transactions[0].name}}

*AI Categorization:*
• Category: {{agent-categorize-1.output.category}}
• Subcategory: {{agent-categorize-1.output.subcategory}}
• Business Purpose: {{agent-categorize-1.output.businessPurpose}}
• Recurring: {{agent-categorize-1.output.isRecurring}}

Please approve or reject this expense.`,
            type: 'long-input',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Sends approval request to Slack channel',
        },
      },

      // Block 6: Human-in-the-Loop - Approval Gate
      {
        id: 'human-approval-1',
        type: 'human_in_the_loop',
        name: 'Await Approval',
        positionX: 1600,
        positionY: 50,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 160,
        subBlocks: {
          question: {
            id: 'question',
            value: 'Approve expense for \${{plaid-get-transaction-1.transactions[0].amount}}?',
            type: 'short-input',
            required: true,
          },
          options: {
            id: 'options',
            value: JSON.stringify(['Approve', 'Reject', 'Request More Info']),
            type: 'code',
            required: true,
          },
          timeout: {
            id: 'timeout',
            value: '24',
            type: 'short-input',
          },
          timeoutUnit: {
            id: 'timeoutUnit',
            value: 'hours',
            type: 'dropdown',
          },
        },
        outputs: {},
        data: {
          description: 'Pauses workflow until human approves or rejects',
        },
      },

      // Block 7: Condition - Check Approval Status
      {
        id: 'condition-approved-1',
        type: 'condition',
        name: 'Approved?',
        positionX: 1900,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 140,
        subBlocks: {
          condition: {
            id: 'condition',
            value: "{{human-approval-1.response}} === 'Approve' || {{condition-amount-check-1.result}} === false",
            type: 'code',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Checks if expense was approved (or auto-approved if under threshold)',
        },
      },

      // Block 8: QuickBooks - Create Expense
      {
        id: 'quickbooks-create-expense-1',
        type: 'quickbooks',
        name: 'Create Expense Entry',
        positionX: 2200,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 220,
        subBlocks: {
          operation: {
            id: 'operation',
            value: 'create_expense',
            type: 'dropdown',
          },
          apiKey: {
            id: 'apiKey',
            value: '{{credentials.quickbooks.accessToken}}',
            type: 'short-input',
            required: true,
          },
          realmId: {
            id: 'realmId',
            value: '{{credentials.quickbooks.realmId}}',
            type: 'short-input',
            required: true,
          },
          AccountRef: {
            id: 'AccountRef',
            value: '{"value": "35", "name": "Bank Account"}',
            type: 'code',
            required: true,
          },
          PaymentType: {
            id: 'PaymentType',
            value: 'CreditCard',
            type: 'dropdown',
            required: true,
          },
          Line: {
            id: 'Line',
            value: `[{
  "Amount": {{plaid-get-transaction-1.transactions[0].amount}},
  "DetailType": "AccountBasedExpenseLineDetail",
  "Description": "{{agent-categorize-1.output.description}}",
  "AccountBasedExpenseLineDetail": {
    "AccountRef": {
      "value": "{{agent-categorize-1.output.category}}",
      "name": "{{agent-categorize-1.output.category}}"
    }
  }
}]`,
            type: 'code',
            required: true,
          },
          TxnDate: {
            id: 'TxnDate',
            value: '{{plaid-get-transaction-1.transactions[0].date}}',
            type: 'short-input',
          },
          PrivateNote: {
            id: 'PrivateNote',
            value: 'Auto-created from Plaid transaction. Category: {{agent-categorize-1.output.category}}. Business Purpose: {{agent-categorize-1.output.businessPurpose}}',
            type: 'long-input',
          },
        },
        outputs: {},
        data: {
          description: 'Creates expense entry in QuickBooks with AI categorization',
        },
      },

      // Block 9: Slack - Confirmation
      {
        id: 'slack-confirm-1',
        type: 'slack',
        name: 'Confirm Recorded',
        positionX: 2500,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 180,
        subBlocks: {
          operation: {
            id: 'operation',
            value: 'send_message',
            type: 'dropdown',
          },
          channel: {
            id: 'channel',
            value: '#accounting',
            type: 'short-input',
            required: true,
          },
          text: {
            id: 'text',
            value: `✅ *Expense Recorded in QuickBooks*

*Transaction:* {{plaid-get-transaction-1.transactions[0].merchant_name}}
*Amount:* \${{plaid-get-transaction-1.transactions[0].amount}}
*Category:* {{agent-categorize-1.output.category}} - {{agent-categorize-1.output.subcategory}}
*QuickBooks ID:* {{quickbooks-create-expense-1.expense.Id}}
*Status:* {{condition-amount-check-1.result ? 'Approved' : 'Auto-approved'}}`,
            type: 'long-input',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Sends confirmation that expense was recorded',
        },
      },
    ],

    edges: [
      // Webhook → Get Transaction Details
      {
        id: 'edge-1',
        sourceBlockId: 'webhook-trigger-1',
        targetBlockId: 'plaid-get-transaction-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Get Transaction → AI Categorization
      {
        id: 'edge-2',
        sourceBlockId: 'plaid-get-transaction-1',
        targetBlockId: 'agent-categorize-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // AI Categorization → Amount Check
      {
        id: 'edge-3',
        sourceBlockId: 'agent-categorize-1',
        targetBlockId: 'condition-amount-check-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Amount Check (true: > $500) → Request Approval
      {
        id: 'edge-4',
        sourceBlockId: 'condition-amount-check-1',
        targetBlockId: 'slack-request-approval-1',
        sourceHandle: 'true',
        targetHandle: null,
      },
      // Request Approval → Human Approval Gate
      {
        id: 'edge-5',
        sourceBlockId: 'slack-request-approval-1',
        targetBlockId: 'human-approval-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Human Approval → Approval Status Check
      {
        id: 'edge-6',
        sourceBlockId: 'human-approval-1',
        targetBlockId: 'condition-approved-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Amount Check (false: < $500) → Approval Status Check (auto-approve path)
      {
        id: 'edge-7',
        sourceBlockId: 'condition-amount-check-1',
        targetBlockId: 'condition-approved-1',
        sourceHandle: 'false',
        targetHandle: null,
      },
      // Approval Status Check (true) → Create QuickBooks Expense
      {
        id: 'edge-8',
        sourceBlockId: 'condition-approved-1',
        targetBlockId: 'quickbooks-create-expense-1',
        sourceHandle: 'true',
        targetHandle: null,
      },
      // Create QuickBooks Expense → Slack Confirmation
      {
        id: 'edge-9',
        sourceBlockId: 'quickbooks-create-expense-1',
        targetBlockId: 'slack-confirm-1',
        sourceHandle: null,
        targetHandle: null,
      },
    ],

    variables: {
      approvalThreshold: 500,
      approvalTimeoutHours: 24,
      defaultExpenseAccount: '35',
    },

    viewport: {
      x: 0,
      y: 0,
      zoom: 0.7,
    },
  },
}
