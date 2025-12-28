import type { TemplateDefinition } from '../types'

/**
 * Late Invoice Reminder Automation Template
 *
 * Description:
 * Automatically sends email reminders for overdue invoices and escalates
 * unpaid invoices to Slack after a grace period.
 *
 * Workflow:
 * 1. Trigger: Daily schedule at 9 AM
 * 2. QuickBooks: Fetch invoices due more than 7 days ago with Balance > 0
 * 3. Loop: For each overdue invoice
 *    a. Resend: Send email reminder to customer
 *    b. Wait: 7 days
 *    c. QuickBooks: Check if invoice is still unpaid
 *    d. Condition: If balance > 0
 *    e. Slack: Alert accountant with invoice details
 *
 * Required Credentials:
 * - QuickBooks Online (accounting)
 * - Resend (email)
 * - Slack (notifications)
 */
export const lateInvoiceReminderTemplate: TemplateDefinition = {
  metadata: {
    id: 'late-invoice-reminder-v1',
    name: 'Late Invoice Reminder Automation',
    description:
      'Automatically sends email reminders for overdue invoices and escalates to Slack if still unpaid after 7 days',
    details: `## 🔔 Late Invoice Reminder Automation

### What it does

This workflow automatically manages overdue invoice collection:

1. **Daily Check**: Runs every morning at 9 AM
2. **Find Overdue**: Fetches QuickBooks invoices due >7 days ago
3. **Email Reminder**: Sends professional reminder to each customer
4. **Grace Period**: Waits 7 days for payment
5. **Escalation**: Alerts accountant via Slack if still unpaid

### Benefits

- ✅ Never miss following up on late payments
- ✅ Improve cash flow with automated reminders
- ✅ Professional customer communication
- ✅ Reduce manual work for accounting team
- ✅ Escalate only critical cases to humans

### Customization

- Adjust overdue threshold (default: 7 days)
- Customize email template
- Change escalation wait time
- Add additional notification channels`,
    tags: ['accounting', 'automation', 'invoices', 'reminders', 'cash-flow'],
    requiredCredentials: [
      {
        provider: 'quickbooks',
        service: 'quickbooks-accounting',
        purpose: 'Fetch overdue invoices and check payment status',
        required: true,
      },
      {
        provider: 'google',
        service: 'gmail',
        purpose: 'Send invoice reminder emails (alternative to Resend)',
        required: false,
      },
      {
        provider: 'slack',
        service: 'slack',
        purpose: 'Send escalation alerts to accounting team',
        required: true,
      },
    ],
    creatorId: 'sim-official',
    status: 'approved',
  },

  state: {
    blocks: [
      // Block 1: Schedule Trigger (Daily at 9 AM)
      {
        id: 'schedule-trigger-1',
        type: 'schedule',
        name: 'Daily at 9 AM',
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
            value: '0 9 * * *', // 9 AM daily (cron format)
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

      // Block 2: QuickBooks - List Overdue Invoices
      {
        id: 'quickbooks-list-invoices-1',
        type: 'quickbooks',
        name: 'Get Overdue Invoices',
        positionX: 400,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 160,
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
            value:
              "SELECT * FROM Invoice WHERE Balance > 0 AND DueDate < '{{$now.subtract(7, 'days').format('YYYY-MM-DD')}}' ORDERBY DueDate ASC",
            type: 'long-input',
          },
          maxResults: {
            id: 'maxResults',
            value: '100',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'Fetches invoices that are overdue by more than 7 days and have an outstanding balance',
        },
      },

      // Block 3: Parallel Loop (Process Each Invoice)
      {
        id: 'parallel-loop-1',
        type: 'parallel_ai',
        name: 'For Each Invoice',
        positionX: 700,
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
            value: '{{quickbooks-list-invoices-1.invoices}}',
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
          description: 'Loops through each overdue invoice and processes it individually',
        },
      },

      // Block 4: Gmail - Send Reminder Email
      {
        id: 'gmail-send-1',
        type: 'gmail',
        name: 'Send Reminder Email',
        positionX: 1050,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 200,
        subBlocks: {
          operation: {
            id: 'operation',
            value: 'send',
            type: 'dropdown',
          },
          to: {
            id: 'to',
            value: '{{parallel-loop-1.item.BillEmail.Address}}',
            type: 'short-input',
            required: true,
          },
          subject: {
            id: 'subject',
            value: 'Reminder: Invoice {{parallel-loop-1.item.DocNumber}} is Past Due',
            type: 'short-input',
            required: true,
          },
          body: {
            id: 'body',
            value: `Dear {{parallel-loop-1.item.CustomerRef.name}},

This is a friendly reminder that Invoice #{{parallel-loop-1.item.DocNumber}} for \${{parallel-loop-1.item.Balance}} is now {{$now.diff(parallel-loop-1.item.DueDate, 'days')}} days past due.

Invoice Details:
- Invoice Number: {{parallel-loop-1.item.DocNumber}}
- Original Due Date: {{parallel-loop-1.item.DueDate}}
- Amount Due: \${{parallel-loop-1.item.Balance}}

Please submit payment at your earliest convenience. If you have already sent payment, please disregard this reminder.

If you have any questions or concerns, please don't hesitate to contact us.

Thank you for your business!`,
            type: 'long-input',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Sends a professional email reminder to the customer',
        },
      },

      // Block 5: Wait 7 Days
      {
        id: 'wait-1',
        type: 'wait',
        name: 'Wait 7 Days',
        positionX: 1400,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 120,
        subBlocks: {
          duration: {
            id: 'duration',
            value: '7',
            type: 'short-input',
            required: true,
          },
          unit: {
            id: 'unit',
            value: 'days',
            type: 'dropdown',
          },
        },
        outputs: {},
        data: {
          description: 'Waits 7 days before checking payment status',
        },
      },

      // Block 6: QuickBooks - Retrieve Invoice (Check Payment Status)
      {
        id: 'quickbooks-retrieve-invoice-1',
        type: 'quickbooks',
        name: 'Check Payment Status',
        positionX: 1700,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 140,
        subBlocks: {
          operation: {
            id: 'operation',
            value: 'retrieve_invoice',
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
          Id: {
            id: 'Id',
            value: '{{parallel-loop-1.item.Id}}',
            type: 'short-input',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Fetches the latest invoice status to check if payment was received',
        },
      },

      // Block 7: Condition - Check if Still Unpaid
      {
        id: 'condition-1',
        type: 'condition',
        name: 'Still Unpaid?',
        positionX: 2000,
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
            value: '{{quickbooks-retrieve-invoice-1.invoice.Balance}} > 0',
            type: 'code',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Checks if the invoice still has an outstanding balance',
        },
      },

      // Block 8: Slack - Alert Accountant
      {
        id: 'slack-send-message-1',
        type: 'slack',
        name: 'Alert Accountant',
        positionX: 2300,
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
            value: `🚨 *Escalated Overdue Invoice*

Invoice #{{parallel-loop-1.item.DocNumber}} is still unpaid after reminder.

*Customer:* {{parallel-loop-1.item.CustomerRef.name}}
*Amount Due:* \${{quickbooks-retrieve-invoice-1.invoice.Balance}}
*Days Overdue:* {{$now.diff(parallel-loop-1.item.DueDate, 'days')}} days
*Original Due Date:* {{parallel-loop-1.item.DueDate}}

Action required: Please follow up with customer.`,
            type: 'long-input',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Sends alert to accounting team for manual follow-up',
        },
      },
    ],

    edges: [
      // Schedule → Get Overdue Invoices
      {
        id: 'edge-1',
        sourceBlockId: 'schedule-trigger-1',
        targetBlockId: 'quickbooks-list-invoices-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Get Overdue Invoices → For Each Invoice
      {
        id: 'edge-2',
        sourceBlockId: 'quickbooks-list-invoices-1',
        targetBlockId: 'parallel-loop-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // For Each Invoice → Send Reminder Email
      {
        id: 'edge-3',
        sourceBlockId: 'parallel-loop-1',
        targetBlockId: 'gmail-send-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Send Reminder Email → Wait 7 Days
      {
        id: 'edge-4',
        sourceBlockId: 'gmail-send-1',
        targetBlockId: 'wait-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Wait 7 Days → Check Payment Status
      {
        id: 'edge-5',
        sourceBlockId: 'wait-1',
        targetBlockId: 'quickbooks-retrieve-invoice-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Check Payment Status → Still Unpaid?
      {
        id: 'edge-6',
        sourceBlockId: 'quickbooks-retrieve-invoice-1',
        targetBlockId: 'condition-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Still Unpaid? (true) → Alert Accountant
      {
        id: 'edge-7',
        sourceBlockId: 'condition-1',
        targetBlockId: 'slack-send-message-1',
        sourceHandle: 'true',
        targetHandle: null,
      },
    ],

    variables: {
      overdueThresholdDays: 7,
      escalationWaitDays: 7,
    },

    viewport: {
      x: 0,
      y: 0,
      zoom: 0.8,
    },
  },
}
