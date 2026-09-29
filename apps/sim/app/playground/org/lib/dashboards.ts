/** Dashboard specs rendered by the real renderer against mock analytics rows. */
export interface MockDashboard {
  id: string
  title: string
  content: string
}

export const MOCK_DASHBOARDS: Record<string, MockDashboard> = {
  'support-operations': {
    id: 'support-operations',
    title: 'Support operations',
    content: `title: Support operations
time: 7d
source:
  tableId: tbl_example_support_tickets
blocks:
  - text: Ticket volume, AI resolution, and response speed across support channels.
  - tabs:
      Overview:
        - row:
            - stat: Tickets handled
              source:
                aggregate:
                  tickets: {op: count}
            - stat: Resolved by AI
              unit: '%'
              source:
                aggregate:
                  resolution: {op: avg, field: col_ai_resolved_pct}
            - stat: First response
              unit: s
              source:
                aggregate:
                  seconds: {op: avg, field: col_first_response_seconds}
            - stat: Escalations
              source:
                filter: {field: col_outcome, op: eq, value: Escalated}
                aggregate:
                  tickets: {op: count}
        - row:
            - chart: Tickets over time
              source:
                groupBy: [createdAt]
                aggregate:
                  tickets: {op: count}
              option:
                grid: {left: 36, right: 24, top: 16, bottom: 32, containLabel: true}
                xAxis: {type: time}
                yAxis: {type: value, name: Tickets, nameLocation: middle, nameGap: 32, minInterval: 1}
                series:
                  - type: line
                    name: Tickets
                    areaStyle: {opacity: 0.04}
                    encode: {x: createdAt, y: tickets}
            - chart: AI resolution rate
              source:
                groupBy: [createdAt]
                aggregate:
                  resolution: {op: avg, field: col_ai_resolved_pct}
              option:
                color: ['#5C7399']
                grid: {left: 16, right: 24, top: 16, bottom: 32, containLabel: true}
                xAxis: {type: time}
                yAxis:
                  type: value
                  min: 0
                  max: 100
                  interval: 25
                  axisLabel: {formatter: '{value}%'}
                series:
                  - type: line
                    name: Resolved by AI
                    encode: {x: createdAt, y: resolution}
        - row:
            - chart: Tickets by topic
              flex: 2
              source:
                groupBy: [col_topic]
                aggregate:
                  tickets: {op: count}
                sort: [{field: tickets, direction: desc}]
              option:
                tooltip: {trigger: axis}
                grid: {left: 16, right: 32, top: 12, bottom: 52, containLabel: true}
                xAxis: {type: value, name: Tickets, nameLocation: middle, nameGap: 44, minInterval: 1}
                yAxis: {type: category, inverse: true}
                series:
                  - type: bar
                    label: {show: true, position: right}
                    encode: {x: tickets, y: col_topic}
            - chart: Resolution outcomes
              source:
                groupBy: [col_outcome]
                aggregate:
                  tickets: {op: count}
                sort: [{field: tickets, direction: desc}]
              option:
                color: ['#5C7399', '#A4A9B1', '#D3D6DB']
                legend: {}
                series:
                  - type: pie
                    radius: ['44%', '66%']
                    center: ['50%', '58%']
                    label: {show: false}
                    encode: {itemName: col_outcome, value: tickets}
      Recent tickets:
        - table: Recent tickets
          source:
            columns: [createdAt, col_ticket, col_topic, col_channel, col_outcome, col_first_response_seconds]
            limit: 20
`,
  },
  'infra-analyzer': {
    id: 'infra-analyzer',
    title: 'Infra analyzer',
    content: `title: Infra analyzer
time: 7d
source:
  tableId: tbl_example_infra_incidents
blocks:
  - text: Investigation volume, report sources, and recurring alarms.
  - tabs:
      Overview:
        - row:
            - stat: Investigations
              source:
                aggregate:
                  total: {op: count}
            - stat: Distinct alarms
              source:
                aggregate:
                  alarms: {op: countDistinct, field: col_alarm_name}
            - stat: Automated reports
              source:
                filter: {field: col_source, op: eq, value: incident.io}
                aggregate:
                  total: {op: count}
        - row:
            - chart: Investigations over time
              source:
                groupBy: [createdAt]
                aggregate:
                  investigations: {op: count}
              option:
                tooltip: {trigger: axis}
                grid: {left: 36, right: 32, top: 16, bottom: 32, containLabel: true}
                xAxis: {type: time}
                yAxis: {type: value, name: Investigations, nameLocation: middle, nameGap: 32, minInterval: 1}
                series:
                  - type: line
                    name: Investigations
                    areaStyle: {opacity: 0.04}
                    encode: {x: createdAt, y: investigations}
            - chart: Automated reports over time
              source:
                filter: {field: col_source, op: eq, value: incident.io}
                groupBy: [createdAt]
                aggregate:
                  reports: {op: count}
              option:
                grid: {left: 36, right: 32, top: 16, bottom: 32, containLabel: true}
                xAxis: {type: time}
                yAxis: {type: value, name: Reports, nameLocation: middle, nameGap: 32, minInterval: 1}
                series:
                  - type: line
                    name: Automated
                    encode: {x: createdAt, y: reports}
        - row:
            - chart: Report sources
              flex: 1
              source:
                groupBy: [col_source]
                aggregate:
                  reports: {op: count}
                sort: [{field: reports, direction: desc}]
              option:
                tooltip: {trigger: axis}
                grid: {left: 16, right: 24, top: 16, bottom: 32, containLabel: true}
                xAxis:
                  type: value
                  name: Investigations
                  nameLocation: middle
                  nameGap: 16
                  axisLabel: {show: false}
                  splitLine: {show: false}
                yAxis: {type: category, inverse: true}
                series:
                  - type: bar
                    label: {show: true, position: right}
                    encode: {x: reports, y: col_source}
            - chart: Most frequent alarms
              flex: 2
              source:
                groupBy: [col_alarm_name]
                aggregate:
                  reports: {op: count}
                sort: [{field: reports, direction: desc}]
                limit: 5
              option:
                tooltip: {trigger: axis}
                grid: {left: 16, right: 24, bottom: 52, containLabel: true}
                xAxis: {type: value, name: Investigations, nameLocation: middle, nameGap: 44, minInterval: 1}
                yAxis: {type: category, inverse: true}
                series:
                  - type: bar
                    label: {show: true, position: right}
                    encode: {x: reports, y: col_alarm_name}
      Recent investigations:
        - table: Recent investigations
          source:
            columns: [createdAt, col_alarm_name, col_source, col_summary]
            limit: 50
`,
  },
  'growth-funnel': {
    id: 'growth-funnel',
    title: 'Growth funnel',
    content: `title: Growth funnel
time: 30d
source:
  tableId: tbl_example_signups
blocks:
  - text: Signups, activation, and acquisition channels.
  - tabs:
      Overview:
        - row:
            - stat: Signups
              source:
                aggregate:
                  signups: {op: count}
            - stat: Activated
              unit: '%'
              source:
                aggregate:
                  activated: {op: avg, field: col_activated_pct}
            - stat: Paid plans
              source:
                filter: {field: col_plan, op: eq, value: Pro}
                aggregate:
                  signups: {op: count}
        - row:
            - chart: Signups over time
              source:
                groupBy: [createdAt]
                aggregate:
                  signups: {op: count}
              option:
                grid: {left: 36, right: 24, top: 16, bottom: 32, containLabel: true}
                xAxis: {type: time}
                yAxis: {type: value, name: Signups, nameLocation: middle, nameGap: 32, minInterval: 1}
                series:
                  - type: line
                    name: Signups
                    areaStyle: {opacity: 0.04}
                    encode: {x: createdAt, y: signups}
            - chart: Signups by channel
              source:
                groupBy: [col_channel]
                aggregate:
                  signups: {op: count}
                sort: [{field: signups, direction: desc}]
              option:
                tooltip: {trigger: axis}
                grid: {left: 16, right: 32, top: 12, bottom: 52, containLabel: true}
                xAxis: {type: value, name: Signups, nameLocation: middle, nameGap: 44, minInterval: 1}
                yAxis: {type: category, inverse: true}
                series:
                  - type: bar
                    label: {show: true, position: right}
                    encode: {x: signups, y: col_channel}
`,
  },
}
