import chalk from 'chalk'
import { Command } from 'commander'
import { clientFrom } from '../context.js'
import { type Column, duration, printList, printRecord, text, timestamp } from '../output/render.js'

interface LogListItem {
  id: string
  workflowId: string | null
  executionId: string
  level: string
  trigger: string
  startedAt: string
  endedAt: string | null
  totalDurationMs: number | null
  cost: { total: number } | null
  workflow?: { id: string | null; name: string; deleted: boolean }
}

interface LogDetail extends LogListItem {
  executionData: unknown
  createdAt: string
}

function level(value: string): string {
  return value === 'error' ? chalk.red(value) : value
}

function cost(value: { total: number } | null): string {
  return value ? `$${value.total.toFixed(4)}` : text(null)
}

const LIST_COLUMNS: Column<LogListItem>[] = [
  { header: 'started', value: (log) => timestamp(log.startedAt) },
  { header: 'level', value: (log) => level(log.level) },
  { header: 'trigger', value: (log) => log.trigger },
  { header: 'workflow', value: (log) => text(log.workflow?.name ?? log.workflowId) },
  { header: 'duration', value: (log) => duration(log.totalDurationMs) },
  { header: 'cost', value: (log) => cost(log.cost) },
  { header: 'execution', value: (log) => log.executionId },
]

export function logsCommand(): Command {
  const logs = new Command('logs').alias('log').description('Read workflow execution logs')

  logs
    .command('list')
    .alias('ls')
    .description('List execution logs in a workspace')
    .option('--workflow <id...>', 'Restrict to these workflow ids')
    .option('--trigger <name...>', 'Restrict to these triggers (api, schedule, webhook, manual…)')
    .option('--level <level>', 'Filter by level: info or error')
    .option('--execution <id>', 'Restrict to a single execution id')
    .option('--start <date>', 'Only runs starting at or after this ISO date')
    .option('--end <date>', 'Only runs starting at or before this ISO date')
    .option('--order <dir>', 'Sort by start time: desc or asc', 'desc')
    .option('--limit <n>', 'Maximum logs to return', '50')
    .action(
      async (
        options: {
          workflow?: string[]
          trigger?: string[]
          level?: string
          execution?: string
          start?: string
          end?: string
          order: string
          limit: string
        },
        command: Command
      ) => {
        const { client, profile } = clientFrom(command)
        const limit = Number.parseInt(options.limit, 10)

        const rows = await client.collect<LogListItem>(
          '/api/v2/logs',
          {
            query: {
              workspaceId: client.requireWorkspace(),
              // The route takes these as comma-joined strings, not repeated params.
              workflowIds: options.workflow?.join(','),
              triggers: options.trigger?.join(','),
              level: options.level,
              executionId: options.execution,
              startDate: options.start,
              endDate: options.end,
              order: options.order,
              details: 'full',
              limit: Math.min(limit, 1000),
            },
          },
          limit
        )

        printList(profile.output, rows, LIST_COLUMNS)
      }
    )

  logs
    .command('get <id>')
    .description('Show one log, including its execution trace')
    .action(async (id: string, _options: unknown, command: Command) => {
      const { client, profile } = clientFrom(command)
      const log = await client.getData<LogDetail>(`/api/v2/logs/${id}`)

      printRecord(
        profile.output,
        [
          ['ID', log.id],
          ['Execution', log.executionId],
          ['Workflow', text(log.workflow?.name ?? log.workflowId)],
          ['Level', level(log.level)],
          ['Trigger', log.trigger],
          ['Started', timestamp(log.startedAt)],
          ['Ended', timestamp(log.endedAt)],
          ['Duration', duration(log.totalDurationMs)],
          ['Cost', cost(log.cost)],
        ],
        log
      )

      if (profile.output === 'table') {
        console.log(chalk.dim('\nRun with --output json to see the full execution trace.'))
      }
    })

  logs
    .command('execution <executionId>')
    .description('Show the workflow state snapshot for an execution')
    .action(async (executionId: string, _options: unknown, command: Command) => {
      const { client, profile } = clientFrom(command)
      const execution = await client.getData<{
        executionId: string
        workflowId: string | null
        executionMetadata: {
          trigger: string
          startedAt: string
          endedAt: string | null
          totalDurationMs: number | null
          cost: { total: number } | null
        }
      }>(`/api/v2/logs/executions/${executionId}`)

      printRecord(
        profile.output,
        [
          ['Execution', execution.executionId],
          ['Workflow', text(execution.workflowId)],
          ['Trigger', execution.executionMetadata.trigger],
          ['Started', timestamp(execution.executionMetadata.startedAt)],
          ['Ended', timestamp(execution.executionMetadata.endedAt)],
          ['Duration', duration(execution.executionMetadata.totalDurationMs)],
          ['Cost', cost(execution.executionMetadata.cost)],
        ],
        execution
      )
    })

  return logs
}
