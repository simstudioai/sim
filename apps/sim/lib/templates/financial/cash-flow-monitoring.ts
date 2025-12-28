import type { TemplateDefinition } from '../types'

/**
 * Cash Flow Monitoring Automation Template
 *
 * Description:
 * Monitors cash flow by analyzing accounts receivable, accounts payable, and
 * bank balances. Sends weekly reports and alerts on concerning trends.
 *
 * Workflow:
 * 1. Trigger: Weekly schedule (Monday 8 AM)
 * 2. QuickBooks: Fetch outstanding invoices (AR)
 * 3. QuickBooks: Fetch unpaid bills (AP)
 * 4. Plaid: Get current bank balances
 * 5. Agent: Analyze cash flow trends and calculate runway
 * 6. Condition: Check if cash runway < 60 days
 * 7. If concerning: Slack alert to leadership
 * 8. Gmail: Send weekly cash flow summary report
 *
 * Required Credentials:
 * - QuickBooks Online (accounting)
 * - Plaid (banking)
 * - Slack (alerts)
 * - Gmail (reports)
 */
export const cashFlowMonitoringTemplate: TemplateDefinition = {
  metadata: {
    id: 'cash-flow-monitoring-v1',
    name: 'Cash Flow Monitoring Automation',
    description:
      'Monitors cash flow health, calculates runway, and alerts on concerning trends',
    details: `## 📊 Cash Flow Monitoring Automation

### What it does

This workflow provides proactive cash flow intelligence for your business:

1. **Weekly Analysis**: Runs every Monday morning to assess cash position
2. **Multi-Source Data**: Combines QuickBooks AR/AP with live bank balances
3. **AI Insights**: Identifies trends, patterns, and potential issues
4. **Runway Calculation**: Calculates days of cash runway at current burn rate
5. **Proactive Alerts**: Warns leadership if runway drops below 60 days
6. **Detailed Reports**: Sends comprehensive weekly cash flow summary

### Benefits

- ✅ Never be surprised by cash flow problems
- ✅ Make informed decisions with accurate runway data
- ✅ Identify collection issues early (slow-paying customers)
- ✅ Optimize payment timing for better cash management
- ✅ Professional investor/board reporting ready

### Customization

- Adjust monitoring frequency (default: weekly)
- Configure runway alert threshold (default: 60 days)
- Add custom metrics and KPIs
- Integrate budget vs. actual comparisons`,
    tags: ['cash-flow', 'monitoring', 'analytics', 'financial-health', 'alerts'],
    requiredCredentials: [
      {
        provider: 'quickbooks',
        service: 'quickbooks-accounting',
        purpose: 'Fetch AR, AP, and financial data',
        required: true,
      },
      {
        provider: 'plaid',
        service: 'plaid-banking',
        purpose: 'Get real-time bank account balances',
        required: true,
      },
      {
        provider: 'slack',
        service: 'slack',
        purpose: 'Send cash flow alerts to leadership',
        required: true,
      },
      {
        provider: 'google',
        service: 'gmail',
        purpose: 'Send weekly cash flow reports',
        required: true,
      },
    ],
    creatorId: 'sim-official',
    status: 'approved',
  },

  state: {
    blocks: [
      // Block 1: Schedule Trigger (Weekly Monday 8 AM)
      {
        id: 'schedule-trigger-1',
        type: 'schedule',
        name: 'Weekly Monday 8 AM',
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
            value: '0 8 * * 1', // 8 AM every Monday (cron format)
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

      // Block 2: QuickBooks - Get Outstanding Invoices (AR)
      {
        id: 'quickbooks-list-invoices-ar-1',
        type: 'quickbooks',
        name: 'Get AR (Receivables)',
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
            value: 'SELECT * FROM Invoice WHERE Balance > 0 ORDER BY DueDate ASC',
            type: 'long-input',
          },
          maxResults: {
            id: 'maxResults',
            value: '500',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'Fetches all outstanding invoices (accounts receivable)',
        },
      },

      // Block 3: QuickBooks - Get Unpaid Bills (AP)
      {
        id: 'quickbooks-list-expenses-ap-1',
        type: 'quickbooks',
        name: 'Get AP (Payables)',
        positionX: 700,
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
            value: 'list_expenses',
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
            value: 'SELECT * FROM Purchase WHERE TxnDate >= \'{{$now.subtract(90, "days").format("YYYY-MM-DD")}}\' ORDER BY TxnDate DESC',
            type: 'long-input',
          },
          maxResults: {
            id: 'maxResults',
            value: '500',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'Fetches recent expenses and bills (accounts payable)',
        },
      },

      // Block 4: Plaid - Get Bank Balances
      {
        id: 'plaid-get-balance-1',
        type: 'plaid',
        name: 'Get Bank Balances',
        positionX: 1000,
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
            value: 'get_balance',
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
        },
        outputs: {},
        data: {
          description: 'Fetches current bank account balances',
        },
      },

      // Block 5: Agent - Analyze Cash Flow
      {
        id: 'agent-analyze-cashflow-1',
        type: 'agent',
        name: 'Analyze Cash Flow',
        positionX: 1300,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 240,
        subBlocks: {
          prompt: {
            id: 'prompt',
            value: `Analyze the cash flow situation for this business:

**Accounts Receivable (Money Owed to Us):**
Invoices: {{quickbooks-list-invoices-ar-1.invoices}}

**Accounts Payable (Money We Owe):**
Expenses: {{quickbooks-list-expenses-ap-1.expenses}}

**Bank Balances:**
Accounts: {{plaid-get-balance-1.accounts}}

Calculate and provide:
1. Total AR (outstanding invoices)
2. AR aging breakdown (0-30, 31-60, 61-90, 90+ days)
3. Total AP (unpaid bills)
4. Current cash position (sum of all bank balances)
5. Average monthly burn rate (based on last 90 days of expenses)
6. Cash runway in days (current cash / monthly burn)
7. Quick ratio (current assets / current liabilities)
8. Trends and insights

Return comprehensive JSON:
{
  "cashPosition": {
    "currentCash": <total bank balance>,
    "totalAR": <sum of outstanding invoices>,
    "totalAP": <sum of unpaid bills>,
    "netWorkingCapital": <current assets - current liabilities>
  },
  "arAging": {
    "current": <0-30 days>,
    "days31to60": <31-60 days>,
    "days61to90": <61-90 days>,
    "over90Days": <90+ days>
  },
  "runway": {
    "monthlyBurnRate": <average monthly expenses>,
    "daysOfRunway": <days until out of cash>,
    "weeksOfRunway": <weeks until out of cash>
  },
  "metrics": {
    "quickRatio": <quick ratio>,
    "dso": <days sales outstanding>
  },
  "insights": [
    "Key insight 1",
    "Key insight 2",
    "Key insight 3"
  ],
  "concerns": [
    "List of any concerning trends"
  ],
  "recommendations": [
    "Action item 1",
    "Action item 2"
  ]
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
          description: 'AI analyzes cash flow and calculates key metrics',
        },
      },

      // Block 6: Condition - Check Cash Runway
      {
        id: 'condition-runway-check-1',
        type: 'condition',
        name: 'Runway < 60 Days?',
        positionX: 1600,
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
            value: '{{agent-analyze-cashflow-1.output.runway.daysOfRunway}} < 60',
            type: 'code',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Checks if cash runway is concerning (less than 60 days)',
        },
      },

      // Block 7: Slack - Critical Alert (Low Runway)
      {
        id: 'slack-alert-low-runway-1',
        type: 'slack',
        name: 'Critical Cash Alert',
        positionX: 1900,
        positionY: 50,
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
            value: '#leadership',
            type: 'short-input',
            required: true,
          },
          text: {
            id: 'text',
            value: `🚨 *CRITICAL: Low Cash Runway Alert*

*Cash Position:*
• Current Cash: \${{agent-analyze-cashflow-1.output.cashPosition.currentCash}}
• Cash Runway: *{{agent-analyze-cashflow-1.output.runway.daysOfRunway}} days* ({{agent-analyze-cashflow-1.output.runway.weeksOfRunway}} weeks)
• Monthly Burn: \${{agent-analyze-cashflow-1.output.runway.monthlyBurnRate}}

*Working Capital:*
• AR (Owed to Us): \${{agent-analyze-cashflow-1.output.cashPosition.totalAR}}
• AP (We Owe): \${{agent-analyze-cashflow-1.output.cashPosition.totalAP}}
• Net Working Capital: \${{agent-analyze-cashflow-1.output.cashPosition.netWorkingCapital}}

*AR Aging:*
• Current (0-30 days): \${{agent-analyze-cashflow-1.output.arAging.current}}
• 31-60 days: \${{agent-analyze-cashflow-1.output.arAging.days31to60}}
• 61-90 days: \${{agent-analyze-cashflow-1.output.arAging.days61to90}}
• 90+ days: \${{agent-analyze-cashflow-1.output.arAging.over90Days}}

*⚠️ Concerns:*
{{agent-analyze-cashflow-1.output.concerns}}

*📋 Recommended Actions:*
{{agent-analyze-cashflow-1.output.recommendations}}

*Action Required:* Immediate review needed.`,
            type: 'long-input',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Sends critical alert if cash runway is low',
        },
      },

      // Block 8: Gmail - Weekly Cash Flow Report
      {
        id: 'gmail-send-report-1',
        type: 'gmail',
        name: 'Send Weekly Report',
        positionX: 1900,
        positionY: 200,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 220,
        subBlocks: {
          operation: {
            id: 'operation',
            value: 'send',
            type: 'dropdown',
          },
          to: {
            id: 'to',
            value: 'cfo@company.com,ceo@company.com',
            type: 'short-input',
            required: true,
          },
          subject: {
            id: 'subject',
            value: 'Weekly Cash Flow Report - {{$now.format("MMMM DD, YYYY")}}',
            type: 'short-input',
            required: true,
          },
          body: {
            id: 'body',
            value: `Weekly Cash Flow Summary
Generated: {{$now.format("MMMM DD, YYYY")}}

═══════════════════════════════════
CASH POSITION
═══════════════════════════════════

Current Cash:           \${{agent-analyze-cashflow-1.output.cashPosition.currentCash}}
Total AR (Receivables): \${{agent-analyze-cashflow-1.output.cashPosition.totalAR}}
Total AP (Payables):    \${{agent-analyze-cashflow-1.output.cashPosition.totalAP}}
Net Working Capital:    \${{agent-analyze-cashflow-1.output.cashPosition.netWorkingCapital}}

═══════════════════════════════════
CASH RUNWAY
═══════════════════════════════════

Monthly Burn Rate: \${{agent-analyze-cashflow-1.output.runway.monthlyBurnRate}}
Days of Runway:    {{agent-analyze-cashflow-1.output.runway.daysOfRunway}} days
Weeks of Runway:   {{agent-analyze-cashflow-1.output.runway.weeksOfRunway}} weeks

═══════════════════════════════════
AR AGING ANALYSIS
═══════════════════════════════════

Current (0-30 days):  \${{agent-analyze-cashflow-1.output.arAging.current}}
31-60 days:           \${{agent-analyze-cashflow-1.output.arAging.days31to60}}
61-90 days:           \${{agent-analyze-cashflow-1.output.arAging.days61to90}}
90+ days overdue:     \${{agent-analyze-cashflow-1.output.arAging.over90Days}}

═══════════════════════════════════
KEY METRICS
═══════════════════════════════════

Quick Ratio:                {{agent-analyze-cashflow-1.output.metrics.quickRatio}}
Days Sales Outstanding:     {{agent-analyze-cashflow-1.output.metrics.dso}} days

═══════════════════════════════════
AI INSIGHTS
═══════════════════════════════════

{{agent-analyze-cashflow-1.output.insights}}

{{#if agent-analyze-cashflow-1.output.concerns}}
⚠️ CONCERNS:
{{agent-analyze-cashflow-1.output.concerns}}
{{/if}}

═══════════════════════════════════
RECOMMENDED ACTIONS
═══════════════════════════════════

{{agent-analyze-cashflow-1.output.recommendations}}

═══════════════════════════════════

This report was automatically generated by your AI finance automation system.`,
            type: 'long-input',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Sends comprehensive weekly cash flow report',
        },
      },
    ],

    edges: [
      // Schedule → Get AR
      {
        id: 'edge-1',
        sourceBlockId: 'schedule-trigger-1',
        targetBlockId: 'quickbooks-list-invoices-ar-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Get AR → Get AP
      {
        id: 'edge-2',
        sourceBlockId: 'quickbooks-list-invoices-ar-1',
        targetBlockId: 'quickbooks-list-expenses-ap-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Get AP → Get Bank Balances
      {
        id: 'edge-3',
        sourceBlockId: 'quickbooks-list-expenses-ap-1',
        targetBlockId: 'plaid-get-balance-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Get Bank Balances → Analyze Cash Flow
      {
        id: 'edge-4',
        sourceBlockId: 'plaid-get-balance-1',
        targetBlockId: 'agent-analyze-cashflow-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Analyze Cash Flow → Check Runway
      {
        id: 'edge-5',
        sourceBlockId: 'agent-analyze-cashflow-1',
        targetBlockId: 'condition-runway-check-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Check Runway (true: < 60 days) → Critical Alert
      {
        id: 'edge-6',
        sourceBlockId: 'condition-runway-check-1',
        targetBlockId: 'slack-alert-low-runway-1',
        sourceHandle: 'true',
        targetHandle: null,
      },
      // Check Runway (always) → Weekly Report (both paths lead here)
      {
        id: 'edge-7',
        sourceBlockId: 'condition-runway-check-1',
        targetBlockId: 'gmail-send-report-1',
        sourceHandle: null,
        targetHandle: null,
      },
    ],

    variables: {
      runwayAlertThreshold: 60, // days
      arAgingBuckets: [30, 60, 90],
      reportRecipients: ['cfo@company.com', 'ceo@company.com'],
    },

    viewport: {
      x: 0,
      y: 0,
      zoom: 0.7,
    },
  },
}
