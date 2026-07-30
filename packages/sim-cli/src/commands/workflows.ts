import chalk from 'chalk'
import { Command } from 'commander'
import { clientFrom } from '../context.js'
import { bool, type Column, printList, printRecord, text, timestamp } from '../output/render.js'

interface WorkflowListItem {
  id: string
  name: string
  description: string | null
  folderId: string | null
  workspaceId: string
  isDeployed: boolean
  deployedAt: string | null
  runCount: number
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
}

interface WorkflowDetail extends WorkflowListItem {
  variables: Record<string, unknown>
  inputs: Array<{ name: string; type: string; description?: string }>
}

const LIST_COLUMNS: Column<WorkflowListItem>[] = [
  { header: 'id', value: (w) => w.id },
  { header: 'name', value: (w) => w.name },
  { header: 'deployed', value: (w) => bool(w.isDeployed) },
  { header: 'runs', value: (w) => String(w.runCount) },
  { header: 'last run', value: (w) => timestamp(w.lastRunAt) },
]

export function workflowsCommand(): Command {
  const workflows = new Command('workflows')
    .alias('workflow')
    .description('List and manage workflows')

  workflows
    .command('list')
    .alias('ls')
    .description('List workflows in a workspace')
    .option('--folder <id>', 'Only workflows in this folder')
    .option('--deployed', 'Only deployed workflows')
    .option('--limit <n>', 'Maximum workflows to return', '50')
    .action(
      async (options: { folder?: string; deployed?: boolean; limit: string }, command: Command) => {
        const { client, profile } = clientFrom(command)
        const limit = Number.parseInt(options.limit, 10)

        const rows = await client.collect<WorkflowListItem>(
          '/api/v2/workflows',
          {
            query: {
              workspaceId: client.requireWorkspace(),
              folderId: options.folder,
              deployedOnly: options.deployed ? 'true' : undefined,
              // The route caps a page at 100; `collect` pages past that up to `limit`.
              limit: Math.min(limit, 100),
            },
          },
          limit
        )

        printList(profile.output, rows, LIST_COLUMNS)
      }
    )

  workflows
    .command('get <id>')
    .description('Show one workflow, including its trigger inputs')
    .action(async (id: string, _options: unknown, command: Command) => {
      const { client, profile } = clientFrom(command)
      const workflow = await client.getData<WorkflowDetail>(`/api/v2/workflows/${id}`)

      printRecord(
        profile.output,
        [
          ['ID', workflow.id],
          ['Name', workflow.name],
          ['Description', text(workflow.description)],
          ['Workspace', workflow.workspaceId],
          ['Folder', text(workflow.folderId)],
          ['Deployed', bool(workflow.isDeployed)],
          ['Deployed at', timestamp(workflow.deployedAt)],
          ['Runs', String(workflow.runCount)],
          ['Last run', timestamp(workflow.lastRunAt)],
          [
            'Inputs',
            workflow.inputs.length > 0
              ? workflow.inputs.map((input) => `${input.name}:${input.type}`).join(', ')
              : text(null),
          ],
          ['Updated', timestamp(workflow.updatedAt)],
        ],
        workflow
      )
    })

  workflows
    .command('deploy <id>')
    .description('Deploy a workflow')
    .action(async (id: string, _options: unknown, command: Command) => {
      const { client, profile } = clientFrom(command)
      const result = await client.getData<Record<string, unknown>>(
        `/api/v2/workflows/${id}/deploy`,
        { method: 'POST' }
      )
      if (profile.output === 'json') {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(chalk.green(`✓ Deployed ${id}`))
    })

  workflows
    .command('undeploy <id>')
    .description('Take a workflow out of deployment')
    .action(async (id: string, _options: unknown, command: Command) => {
      const { client, profile } = clientFrom(command)
      const result = await client.getData<Record<string, unknown>>(
        `/api/v2/workflows/${id}/deploy`,
        { method: 'DELETE' }
      )
      if (profile.output === 'json') {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(chalk.green(`✓ Undeployed ${id}`))
    })

  workflows
    .command('rollback <id>')
    .description('Roll a deployed workflow back to its previous version')
    .action(async (id: string, _options: unknown, command: Command) => {
      const { client, profile } = clientFrom(command)
      const result = await client.getData<Record<string, unknown>>(
        `/api/v2/workflows/${id}/rollback`,
        { method: 'POST' }
      )
      if (profile.output === 'json') {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(chalk.green(`✓ Rolled back ${id}`))
    })

  return workflows
}
