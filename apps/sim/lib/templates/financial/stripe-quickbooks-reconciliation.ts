import type { TemplateDefinition } from '../types'

/**
 * Stripe→QuickBooks Reconciliation Automation Template
 *
 * Description:
 * Automatically syncs Stripe payments to QuickBooks and reconciles daily totals
 * to ensure accurate financial records across platforms.
 *
 * Workflow:
 * 1. Trigger: Daily schedule at 11 PM
 * 2. Stripe: Fetch payments/charges from the past 24 hours
 * 3. Loop: For each Stripe payment
 *    a. QuickBooks: Create or update payment/invoice entry
 *    b. Variables: Track total synced amount
 * 4. QuickBooks: Query today's payments for verification
 * 5. Agent: Compare Stripe total vs QuickBooks total
 * 6. Condition: Check if totals match within tolerance
 * 7. Slack: Send reconciliation report (success or discrepancy alert)
 *
 * Required Credentials:
 * - Stripe (payments)
 * - QuickBooks Online (accounting)
 * - Slack (notifications)
 */
export const stripeQuickBooksReconciliationTemplate: TemplateDefinition = {
  metadata: {
    id: 'stripe-quickbooks-reconciliation-v1',
    name: 'Stripe→QuickBooks Reconciliation Automation',
    description:
      'Automatically syncs Stripe payments to QuickBooks and reconciles daily totals',
    details: `## 🔄 Stripe→QuickBooks Reconciliation Automation

### What it does

This workflow ensures your payment platform and accounting system stay in perfect sync:

1. **Daily Sync**: Runs every night at 11 PM to sync the day's transactions
2. **Payment Transfer**: Creates QuickBooks entries for all Stripe payments
3. **Smart Matching**: Links payments to existing invoices when possible
4. **Reconciliation**: Compares totals between Stripe and QuickBooks
5. **Alerts**: Notifies accounting team of any discrepancies

### Benefits

- ✅ Eliminate manual payment entry (save 2-3 hours daily)
- ✅ Prevent accounting errors from human data entry
- ✅ Real-time visibility into payment status
- ✅ Automatic detection of reconciliation issues
- ✅ Complete audit trail for all transactions

### Customization

- Adjust sync schedule (default: daily at 11 PM)
- Configure reconciliation tolerance (default: $1.00)
- Add custom payment categorization rules
- Integrate with other payment processors`,
    tags: ['reconciliation', 'payments', 'automation', 'stripe', 'accounting'],
    requiredCredentials: [
      {
        provider: 'stripe',
        service: 'stripe-payments',
        purpose: 'Fetch payment and charge data from Stripe',
        required: true,
      },
      {
        provider: 'quickbooks',
        service: 'quickbooks-accounting',
        purpose: 'Create payment entries and query for reconciliation',
        required: true,
      },
      {
        provider: 'slack',
        service: 'slack',
        purpose: 'Send reconciliation reports and alerts',
        required: true,
      },
    ],
    creatorId: 'sim-official',
    status: 'approved',
  },

  state: {
    blocks: [
      // Block 1: Schedule Trigger (Daily at 11 PM)
      {
        id: 'schedule-trigger-1',
        type: 'schedule',
        name: 'Daily at 11 PM',
        positionX: 100,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: true,
        height: 120,
        subBlocks: {
          schedule: {
            id: 'schedule',
            value: '0 23 * * *', // 11 PM daily (cron format)
            type: 'short-input',
          },
          timezone: {
            id: 'timezone',
            value: 'America/New_York',
            type: 'dropdown',
          },
        },
        outputs: {},
        data: {},
      },

      // Block 2: Stripe - List Payments from Last 24 Hours
      {
        id: 'stripe-list-payments-1',
        type: 'stripe',
        name: 'Get Today\'s Payments',
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
            value: 'list_payment_intents',
            type: 'dropdown',
          },
          apiKey: {
            id: 'apiKey',
            value: '{{credentials.stripe.secretKey}}',
            type: 'short-input',
            required: true,
          },
          created: {
            id: 'created',
            value: JSON.stringify({
              gte: '{{$now.subtract(1, "days").unix()}}',
              lt: '{{$now.unix()}}',
            }),
            type: 'code',
          },
          limit: {
            id: 'limit',
            value: '100',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'Fetches all Stripe payments from the past 24 hours',
        },
      },

      // Block 3: Variables - Initialize Counters
      {
        id: 'variables-init-1',
        type: 'variables',
        name: 'Initialize Counters',
        positionX: 700,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 160,
        subBlocks: {
          variables: {
            id: 'variables',
            value: JSON.stringify({
              stripeTotalAmount: 0,
              stripePaymentCount: 0,
              quickbooksSyncedCount: 0,
              syncErrors: [],
            }),
            type: 'code',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Initializes tracking variables for reconciliation',
        },
      },

      // Block 4: Parallel Loop - Process Each Payment
      {
        id: 'parallel-loop-1',
        type: 'parallel_ai',
        name: 'For Each Payment',
        positionX: 1000,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: true,
        advancedMode: false,
        triggerMode: false,
        height: 140,
        subBlocks: {
          items: {
            id: 'items',
            value: '{{stripe-list-payments-1.paymentIntents.data}}',
            type: 'code',
            required: true,
          },
          maxConcurrency: {
            id: 'maxConcurrency',
            value: '5',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'Processes each Stripe payment in parallel',
        },
      },

      // Block 5: QuickBooks - Create Payment Entry
      {
        id: 'quickbooks-create-payment-1',
        type: 'quickbooks',
        name: 'Create Payment',
        positionX: 1350,
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
            value: 'create_invoice',
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
          CustomerRef: {
            id: 'CustomerRef',
            value: '{"value": "{{parallel-loop-1.item.customer}}", "name": "Stripe Customer"}',
            type: 'code',
            required: true,
          },
          Line: {
            id: 'Line',
            value: `[{
  "Amount": {{parallel-loop-1.item.amount}} / 100,
  "DetailType": "SalesItemLineDetail",
  "Description": "Stripe Payment: {{parallel-loop-1.item.id}}",
  "SalesItemLineDetail": {
    "ItemRef": {
      "value": "1",
      "name": "Services"
    }
  }
}]`,
            type: 'code',
            required: true,
          },
          TxnDate: {
            id: 'TxnDate',
            value: '{{$fromUnix(parallel-loop-1.item.created).format("YYYY-MM-DD")}}',
            type: 'short-input',
          },
          DocNumber: {
            id: 'DocNumber',
            value: 'STRIPE-{{parallel-loop-1.item.id}}',
            type: 'short-input',
          },
          BillEmail: {
            id: 'BillEmail',
            value: '{"Address": "{{parallel-loop-1.item.receipt_email}}"}',
            type: 'code',
          },
        },
        outputs: {},
        data: {
          description: 'Creates QuickBooks invoice/payment for Stripe transaction',
        },
      },

      // Block 6: Variables - Update Counters
      {
        id: 'variables-update-1',
        type: 'variables',
        name: 'Update Counters',
        positionX: 1650,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 160,
        subBlocks: {
          variables: {
            id: 'variables',
            value: JSON.stringify({
              quickbooksSyncedCount: '{{variables-init-1.quickbooksSyncedCount}} + 1',
            }),
            type: 'code',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Increments success counter after successful sync',
        },
      },

      // Block 7: Agent - Calculate Stripe Total
      {
        id: 'agent-calculate-total-1',
        type: 'agent',
        name: 'Calculate Totals',
        positionX: 1950,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 180,
        subBlocks: {
          prompt: {
            id: 'prompt',
            value: `Calculate the total from these Stripe payments:

Payments: {{stripe-list-payments-1.paymentIntents.data}}

Sum all 'amount' fields (they are in cents, divide by 100 for dollars).
Count the number of successful payments.

Return JSON:
{
  "totalAmount": <total in dollars>,
  "paymentCount": <number of payments>,
  "currency": "usd"
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
            value: '0',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'Calculates total Stripe payment amount for reconciliation',
        },
      },

      // Block 8: QuickBooks - Query Today's Payments
      {
        id: 'quickbooks-list-payments-1',
        type: 'quickbooks',
        name: 'Query QB Payments',
        positionX: 2250,
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
            value: 'list_invoices',
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
          query: {
            id: 'query',
            value: "SELECT * FROM Invoice WHERE DocNumber LIKE 'STRIPE-%' AND TxnDate = '{{$now.format('YYYY-MM-DD')}}' ORDERBY TxnDate DESC",
            type: 'long-input',
          },
          maxResults: {
            id: 'maxResults',
            value: '200',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'Fetches QuickBooks entries created today from Stripe',
        },
      },

      // Block 9: Agent - Compare and Reconcile
      {
        id: 'agent-reconcile-1',
        type: 'agent',
        name: 'Reconcile Totals',
        positionX: 2550,
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
            value: `Reconcile these payment totals:

**Stripe:**
- Total Amount: \${{agent-calculate-total-1.output.totalAmount}}
- Payment Count: {{agent-calculate-total-1.output.paymentCount}}

**QuickBooks:**
- Invoices: {{quickbooks-list-payments-1.invoices}}
- Synced Count: {{variables-update-1.quickbooksSyncedCount}}

Calculate the QuickBooks total by summing all Balance fields.
Compare with Stripe total.

Return JSON:
{
  "stripeTotal": <amount>,
  "quickbooksTotal": <amount>,
  "difference": <absolute difference>,
  "percentageDiff": <percentage>,
  "isReconciled": <true if difference < $1.00>,
  "discrepancies": [<list of issues if any>]
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
            value: '0',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'Compares Stripe and QuickBooks totals for reconciliation',
        },
      },

      // Block 10: Condition - Check Reconciliation Status
      {
        id: 'condition-reconciled-1',
        type: 'condition',
        name: 'Reconciled?',
        positionX: 2850,
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
            value: '{{agent-reconcile-1.output.isReconciled}} === true',
            type: 'code',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Checks if reconciliation was successful (difference < $1.00)',
        },
      },

      // Block 11: Slack - Success Report
      {
        id: 'slack-success-1',
        type: 'slack',
        name: 'Success Report',
        positionX: 3150,
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
            value: '#accounting',
            type: 'short-input',
            required: true,
          },
          text: {
            id: 'text',
            value: `✅ *Daily Reconciliation Complete*

*Date:* {{$now.format('YYYY-MM-DD')}}

*Stripe Payments:*
• Total: \${{agent-calculate-total-1.output.totalAmount}}
• Count: {{agent-calculate-total-1.output.paymentCount}}

*QuickBooks:*
• Total: \${{agent-reconcile-1.output.quickbooksTotal}}
• Synced: {{variables-update-1.quickbooksSyncedCount}} entries

*Status:* ✅ Reconciled
*Difference:* \${{agent-reconcile-1.output.difference}}

All payments synced successfully!`,
            type: 'long-input',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Sends success report to accounting team',
        },
      },

      // Block 12: Slack - Discrepancy Alert
      {
        id: 'slack-alert-1',
        type: 'slack',
        name: 'Discrepancy Alert',
        positionX: 3150,
        positionY: 150,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 220,
        subBlocks: {
          operation: {
            id: 'operation',
            value: 'send_message',
            type: 'dropdown',
          },
          channel: {
            id: 'channel',
            value: '#accounting-alerts',
            type: 'short-input',
            required: true,
          },
          text: {
            id: 'text',
            value: `🚨 *Reconciliation Discrepancy Detected*

*Date:* {{$now.format('YYYY-MM-DD')}}

*Stripe Payments:*
• Total: \${{agent-calculate-total-1.output.totalAmount}}
• Count: {{agent-calculate-total-1.output.paymentCount}}

*QuickBooks:*
• Total: \${{agent-reconcile-1.output.quickbooksTotal}}
• Synced: {{variables-update-1.quickbooksSyncedCount}} entries

*❌ Discrepancy:*
• Difference: \${{agent-reconcile-1.output.difference}}
• Percentage: {{agent-reconcile-1.output.percentageDiff}}%

*Issues:*
{{agent-reconcile-1.output.discrepancies}}

*Action Required:* Please review and reconcile manually.`,
            type: 'long-input',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Sends alert when reconciliation fails',
        },
      },
    ],

    edges: [
      // Schedule → Get Stripe Payments
      {
        id: 'edge-1',
        sourceBlockId: 'schedule-trigger-1',
        targetBlockId: 'stripe-list-payments-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Get Stripe Payments → Initialize Variables
      {
        id: 'edge-2',
        sourceBlockId: 'stripe-list-payments-1',
        targetBlockId: 'variables-init-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Initialize Variables → For Each Payment
      {
        id: 'edge-3',
        sourceBlockId: 'variables-init-1',
        targetBlockId: 'parallel-loop-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // For Each Payment → Create QuickBooks Payment
      {
        id: 'edge-4',
        sourceBlockId: 'parallel-loop-1',
        targetBlockId: 'quickbooks-create-payment-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Create QuickBooks Payment → Update Counters
      {
        id: 'edge-5',
        sourceBlockId: 'quickbooks-create-payment-1',
        targetBlockId: 'variables-update-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Update Counters → Calculate Stripe Total
      {
        id: 'edge-6',
        sourceBlockId: 'variables-update-1',
        targetBlockId: 'agent-calculate-total-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Calculate Stripe Total → Query QuickBooks Payments
      {
        id: 'edge-7',
        sourceBlockId: 'agent-calculate-total-1',
        targetBlockId: 'quickbooks-list-payments-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Query QuickBooks Payments → Reconcile Totals
      {
        id: 'edge-8',
        sourceBlockId: 'quickbooks-list-payments-1',
        targetBlockId: 'agent-reconcile-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Reconcile Totals → Check Reconciliation
      {
        id: 'edge-9',
        sourceBlockId: 'agent-reconcile-1',
        targetBlockId: 'condition-reconciled-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Check Reconciliation (true) → Success Report
      {
        id: 'edge-10',
        sourceBlockId: 'condition-reconciled-1',
        targetBlockId: 'slack-success-1',
        sourceHandle: 'true',
        targetHandle: null,
      },
      // Check Reconciliation (false) → Discrepancy Alert
      {
        id: 'edge-11',
        sourceBlockId: 'condition-reconciled-1',
        targetBlockId: 'slack-alert-1',
        sourceHandle: 'false',
        targetHandle: null,
      },
    ],

    variables: {
      reconciliationTolerance: 1.0, // $1.00 tolerance for rounding differences
      syncSchedule: '0 23 * * *', // 11 PM daily
    },

    viewport: {
      x: 0,
      y: 0,
      zoom: 0.6,
    },
  },
}
