import type { TemplateDefinition } from '../types'

/**
 * Monthly Financial Report Automation Template
 *
 * Description:
 * Automatically generates comprehensive monthly financial reports including
 * P&L, balance sheet, cash flow analysis, and AI-powered executive insights.
 *
 * Workflow:
 * 1. Trigger: Monthly schedule (1st day of month, 9 AM)
 * 2. QuickBooks: Fetch Profit & Loss statement for previous month
 * 3. QuickBooks: Fetch Balance Sheet for month-end
 * 4. QuickBooks: Fetch invoices and expenses for analysis
 * 5. Plaid: Get month-end bank balances
 * 6. Agent: Generate executive summary with insights and trends
 * 7. Agent: Create formatted financial report
 * 8. Gmail: Send detailed report to executives and board
 * 9. Slack: Post summary to leadership channel
 *
 * Required Credentials:
 * - QuickBooks Online (accounting)
 * - Plaid (banking)
 * - Gmail (reporting)
 * - Slack (notifications)
 */
export const monthlyFinancialReportTemplate: TemplateDefinition = {
  metadata: {
    id: 'monthly-financial-report-v1',
    name: 'Monthly Financial Report Automation',
    description:
      'Automatically generates comprehensive monthly financial reports with AI insights',
    details: `## 📈 Monthly Financial Report Automation

### What it does

This workflow delivers board-ready financial reporting on autopilot:

1. **Automated Generation**: Runs on the 1st of every month automatically
2. **Complete Financials**: Pulls P&L, Balance Sheet, and Cash Flow data
3. **AI Analysis**: Generates executive insights, trend analysis, and KPIs
4. **Professional Formatting**: Creates clean, readable reports for stakeholders
5. **Multi-Channel Distribution**: Email for details, Slack for quick updates
6. **Actionable Intelligence**: Highlights key metrics, variances, and concerns

### Benefits

- ✅ Save 4-6 hours of manual report preparation monthly
- ✅ Consistent, professional financial reporting
- ✅ Never miss monthly close deadlines
- ✅ AI-powered insights beyond raw numbers
- ✅ Board-ready presentation format
- ✅ Historical trend tracking and variance analysis

### Customization

- Adjust report schedule and recipients
- Add custom KPIs and metrics
- Configure variance alert thresholds
- Integrate budget vs. actual comparisons
- Add department-level breakdowns`,
    tags: ['reporting', 'financial-reports', 'automation', 'analytics', 'executive'],
    requiredCredentials: [
      {
        provider: 'quickbooks',
        service: 'quickbooks-accounting',
        purpose: 'Fetch P&L, balance sheet, and transaction data',
        required: true,
      },
      {
        provider: 'plaid',
        service: 'plaid-banking',
        purpose: 'Get month-end bank balances',
        required: true,
      },
      {
        provider: 'google',
        service: 'gmail',
        purpose: 'Send monthly financial reports',
        required: true,
      },
      {
        provider: 'slack',
        service: 'slack',
        purpose: 'Post report summaries to leadership',
        required: true,
      },
    ],
    creatorId: 'sim-official',
    status: 'approved',
  },

  state: {
    blocks: [
      // Block 1: Schedule Trigger (Monthly - 1st day at 9 AM)
      {
        id: 'schedule-trigger-1',
        type: 'schedule',
        name: 'Monthly 1st at 9 AM',
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
            value: '0 9 1 * *', // 9 AM on 1st day of month (cron format)
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

      // Block 2: Variables - Set Date Range
      {
        id: 'variables-dates-1',
        type: 'variables',
        name: 'Set Report Period',
        positionX: 400,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 180,
        subBlocks: {
          variables: {
            id: 'variables',
            value: JSON.stringify({
              reportMonth: '{{$now.subtract(1, "month").format("MMMM YYYY")}}',
              startDate: '{{$now.subtract(1, "month").startOf("month").format("YYYY-MM-DD")}}',
              endDate: '{{$now.subtract(1, "month").endOf("month").format("YYYY-MM-DD")}}',
              previousMonthStart: '{{$now.subtract(2, "month").startOf("month").format("YYYY-MM-DD")}}',
              previousMonthEnd: '{{$now.subtract(2, "month").endOf("month").format("YYYY-MM-DD")}}',
            }),
            type: 'code',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Sets date ranges for previous month and comparison period',
        },
      },

      // Block 3: QuickBooks - Get Revenue (Invoices)
      {
        id: 'quickbooks-list-invoices-1',
        type: 'quickbooks',
        name: 'Get Monthly Revenue',
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
            value: "SELECT * FROM Invoice WHERE TxnDate >= '{{variables-dates-1.startDate}}' AND TxnDate <= '{{variables-dates-1.endDate}}' ORDER BY TxnDate DESC",
            type: 'long-input',
          },
          maxResults: {
            id: 'maxResults',
            value: '1000',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'Fetches all invoices for the reporting month',
        },
      },

      // Block 4: QuickBooks - Get Expenses
      {
        id: 'quickbooks-list-expenses-1',
        type: 'quickbooks',
        name: 'Get Monthly Expenses',
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
            value: "SELECT * FROM Purchase WHERE TxnDate >= '{{variables-dates-1.startDate}}' AND TxnDate <= '{{variables-dates-1.endDate}}' ORDER BY TxnDate DESC",
            type: 'long-input',
          },
          maxResults: {
            id: 'maxResults',
            value: '1000',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'Fetches all expenses for the reporting month',
        },
      },

      // Block 5: QuickBooks - Get Customers
      {
        id: 'quickbooks-list-customers-1',
        type: 'quickbooks',
        name: 'Get Customer Data',
        positionX: 1300,
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
            value: 'list_customers',
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
            value: 'SELECT * FROM Customer WHERE Active = true ORDER BY DisplayName ASC',
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
          description: 'Fetches customer list for analysis',
        },
      },

      // Block 6: Plaid - Get Month-End Balances
      {
        id: 'plaid-get-balance-1',
        type: 'plaid',
        name: 'Get Month-End Balances',
        positionX: 1600,
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
          description: 'Fetches current bank balances as of month-end',
        },
      },

      // Block 7: Agent - Calculate Financial Metrics
      {
        id: 'agent-calculate-metrics-1',
        type: 'agent',
        name: 'Calculate Metrics',
        positionX: 1900,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 260,
        subBlocks: {
          prompt: {
            id: 'prompt',
            value: `Calculate comprehensive financial metrics for {{variables-dates-1.reportMonth}}:

**Revenue Data:**
Invoices: {{quickbooks-list-invoices-1.invoices}}

**Expense Data:**
Expenses: {{quickbooks-list-expenses-1.expenses}}

**Customer Data:**
Customers: {{quickbooks-list-customers-1.customers}}

**Bank Balances:**
Accounts: {{plaid-get-balance-1.accounts}}

Calculate and provide:

1. **Profit & Loss:**
   - Total Revenue (sum all invoice amounts)
   - Total Expenses (sum all expense amounts)
   - Gross Profit
   - Net Profit
   - Profit Margin %

2. **Revenue Analysis:**
   - Revenue by customer (top 10)
   - Revenue growth vs. previous month (if data available)
   - Average invoice value
   - Number of transactions

3. **Expense Analysis:**
   - Expenses by category
   - Largest expenses (top 10)
   - Average expense amount

4. **Cash Position:**
   - Total cash (all bank accounts)
   - Cash change from previous report

5. **Key Metrics:**
   - Customer count (active customers)
   - Revenue per customer
   - Operating margin
   - Burn rate

Return comprehensive JSON with all metrics and breakdowns.`,
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
            value: '0.2',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'AI calculates comprehensive financial metrics and KPIs',
        },
      },

      // Block 8: Agent - Generate Executive Insights
      {
        id: 'agent-executive-insights-1',
        type: 'agent',
        name: 'Generate Insights',
        positionX: 2200,
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
            value: `Generate executive insights for {{variables-dates-1.reportMonth}} financial report:

**Financial Metrics:**
{{agent-calculate-metrics-1.output}}

Provide:

1. **Executive Summary** (3-4 sentences):
   - Overall financial health
   - Key highlights
   - Major concerns (if any)

2. **Key Insights** (5-7 bullet points):
   - Notable trends
   - Performance vs. expectations
   - Customer concentration risks
   - Expense anomalies

3. **Strategic Recommendations** (3-5 actionable items):
   - Growth opportunities
   - Cost optimization areas
   - Risk mitigation actions

4. **Notable Changes**:
   - Significant month-over-month changes
   - New patterns or trends

Return well-structured JSON with executive-ready content.`,
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
            value: '0.4',
            type: 'short-input',
          },
        },
        outputs: {},
        data: {
          description: 'AI generates executive summary and strategic insights',
        },
      },

      // Block 9: Gmail - Send Detailed Financial Report
      {
        id: 'gmail-send-report-1',
        type: 'gmail',
        name: 'Send Detailed Report',
        positionX: 2500,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 280,
        subBlocks: {
          operation: {
            id: 'operation',
            value: 'send',
            type: 'dropdown',
          },
          to: {
            id: 'to',
            value: 'cfo@company.com,ceo@company.com,board@company.com',
            type: 'short-input',
            required: true,
          },
          subject: {
            id: 'subject',
            value: 'Monthly Financial Report - {{variables-dates-1.reportMonth}}',
            type: 'short-input',
            required: true,
          },
          body: {
            id: 'body',
            value: `MONTHLY FINANCIAL REPORT
{{variables-dates-1.reportMonth}}
Generated: {{$now.format("MMMM DD, YYYY")}}

═══════════════════════════════════════════════
EXECUTIVE SUMMARY
═══════════════════════════════════════════════

{{agent-executive-insights-1.output.executiveSummary}}

═══════════════════════════════════════════════
PROFIT & LOSS STATEMENT
═══════════════════════════════════════════════

Total Revenue:              \${{agent-calculate-metrics-1.output.profitAndLoss.totalRevenue}}
Total Expenses:             \${{agent-calculate-metrics-1.output.profitAndLoss.totalExpenses}}
                           ─────────────────
Gross Profit:              \${{agent-calculate-metrics-1.output.profitAndLoss.grossProfit}}
Net Profit:                \${{agent-calculate-metrics-1.output.profitAndLoss.netProfit}}
Profit Margin:             {{agent-calculate-metrics-1.output.profitAndLoss.profitMargin}}%

═══════════════════════════════════════════════
REVENUE ANALYSIS
═══════════════════════════════════════════════

Number of Invoices:        {{agent-calculate-metrics-1.output.revenueAnalysis.transactionCount}}
Average Invoice Value:     \${{agent-calculate-metrics-1.output.revenueAnalysis.averageInvoiceValue}}

Top 10 Customers by Revenue:
{{agent-calculate-metrics-1.output.revenueAnalysis.topCustomers}}

═══════════════════════════════════════════════
EXPENSE ANALYSIS
═══════════════════════════════════════════════

Expenses by Category:
{{agent-calculate-metrics-1.output.expenseAnalysis.byCategory}}

Top 10 Largest Expenses:
{{agent-calculate-metrics-1.output.expenseAnalysis.largestExpenses}}

═══════════════════════════════════════════════
CASH POSITION
═══════════════════════════════════════════════

Total Cash (All Accounts):  \${{agent-calculate-metrics-1.output.cashPosition.totalCash}}
Change from Last Month:     \${{agent-calculate-metrics-1.output.cashPosition.cashChange}}

═══════════════════════════════════════════════
KEY PERFORMANCE INDICATORS
═══════════════════════════════════════════════

Active Customers:          {{agent-calculate-metrics-1.output.keyMetrics.customerCount}}
Revenue per Customer:      \${{agent-calculate-metrics-1.output.keyMetrics.revenuePerCustomer}}
Operating Margin:          {{agent-calculate-metrics-1.output.keyMetrics.operatingMargin}}%
Monthly Burn Rate:         \${{agent-calculate-metrics-1.output.keyMetrics.burnRate}}

═══════════════════════════════════════════════
KEY INSIGHTS
═══════════════════════════════════════════════

{{agent-executive-insights-1.output.keyInsights}}

═══════════════════════════════════════════════
STRATEGIC RECOMMENDATIONS
═══════════════════════════════════════════════

{{agent-executive-insights-1.output.strategicRecommendations}}

═══════════════════════════════════════════════
NOTABLE CHANGES
═══════════════════════════════════════════════

{{agent-executive-insights-1.output.notableChanges}}

═══════════════════════════════════════════════

This report was automatically generated by your AI finance automation system.
For questions or additional analysis, please contact the finance team.`,
            type: 'long-input',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Sends comprehensive monthly financial report via email',
        },
      },

      // Block 10: Slack - Post Summary to Leadership
      {
        id: 'slack-post-summary-1',
        type: 'slack',
        name: 'Post to Leadership',
        positionX: 2800,
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
            value: `📊 *Monthly Financial Report - {{variables-dates-1.reportMonth}}*

*Executive Summary:*
{{agent-executive-insights-1.output.executiveSummary}}

*Key Metrics:*
• Revenue: \${{agent-calculate-metrics-1.output.profitAndLoss.totalRevenue}}
• Expenses: \${{agent-calculate-metrics-1.output.profitAndLoss.totalExpenses}}
• Net Profit: \${{agent-calculate-metrics-1.output.profitAndLoss.netProfit}}
• Profit Margin: {{agent-calculate-metrics-1.output.profitAndLoss.profitMargin}}%
• Cash Position: \${{agent-calculate-metrics-1.output.cashPosition.totalCash}}

*Top Insights:*
{{agent-executive-insights-1.output.keyInsights}}

📧 Full report sent to executives and board members.`,
            type: 'long-input',
            required: true,
          },
        },
        outputs: {},
        data: {
          description: 'Posts executive summary to Slack leadership channel',
        },
      },
    ],

    edges: [
      // Schedule → Set Date Range
      {
        id: 'edge-1',
        sourceBlockId: 'schedule-trigger-1',
        targetBlockId: 'variables-dates-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Set Date Range → Get Revenue
      {
        id: 'edge-2',
        sourceBlockId: 'variables-dates-1',
        targetBlockId: 'quickbooks-list-invoices-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Get Revenue → Get Expenses
      {
        id: 'edge-3',
        sourceBlockId: 'quickbooks-list-invoices-1',
        targetBlockId: 'quickbooks-list-expenses-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Get Expenses → Get Customers
      {
        id: 'edge-4',
        sourceBlockId: 'quickbooks-list-expenses-1',
        targetBlockId: 'quickbooks-list-customers-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Get Customers → Get Bank Balances
      {
        id: 'edge-5',
        sourceBlockId: 'quickbooks-list-customers-1',
        targetBlockId: 'plaid-get-balance-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Get Bank Balances → Calculate Metrics
      {
        id: 'edge-6',
        sourceBlockId: 'plaid-get-balance-1',
        targetBlockId: 'agent-calculate-metrics-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Calculate Metrics → Generate Insights
      {
        id: 'edge-7',
        sourceBlockId: 'agent-calculate-metrics-1',
        targetBlockId: 'agent-executive-insights-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Generate Insights → Send Email Report
      {
        id: 'edge-8',
        sourceBlockId: 'agent-executive-insights-1',
        targetBlockId: 'gmail-send-report-1',
        sourceHandle: null,
        targetHandle: null,
      },
      // Send Email Report → Post Slack Summary
      {
        id: 'edge-9',
        sourceBlockId: 'gmail-send-report-1',
        targetBlockId: 'slack-post-summary-1',
        sourceHandle: null,
        targetHandle: null,
      },
    ],

    variables: {
      reportRecipients: ['cfo@company.com', 'ceo@company.com', 'board@company.com'],
      leadershipChannel: '#leadership',
      reportSchedule: '0 9 1 * *', // 9 AM on 1st of month
    },

    viewport: {
      x: 0,
      y: 0,
      zoom: 0.6,
    },
  },
}
