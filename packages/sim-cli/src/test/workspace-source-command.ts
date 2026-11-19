import { Command } from 'commander'
import { attachWorkflowSourceCheck } from '../commands/protocol/workflow-source-check'
import { attachWorkspaceSourceApply } from '../commands/protocol/workspace-source-apply'
import { attachWorkspaceSourceCheck } from '../commands/protocol/workspace-source-check'
import { attachWorkspaceSourceGet } from '../commands/protocol/workspace-source-get'

/**
 * Parses `sim workspaces source <command> --dir <dir> ...argv` through the real commander wiring,
 * with exits thrown instead of ending the process.
 */
export async function runWorkspaceSource(
  command: 'get' | 'apply' | 'check',
  dir: string,
  ...argv: string[]
): Promise<void> {
  const root = new Command('sim')
  const source = root.command('workspaces').command('source')
  if (command === 'get') attachWorkspaceSourceGet(source)
  else if (command === 'check') attachWorkspaceSourceCheck(source)
  else attachWorkspaceSourceApply(source)
  root.exitOverride()
  await root.parseAsync(['node', 'sim', 'workspaces', 'source', command, '--dir', dir, ...argv])
}

/** Parses `sim workflows source check --dir <dir>` through the real commander wiring. */
export async function runWorkflowSourceCheck(dir: string): Promise<void> {
  const root = new Command('sim')
  attachWorkflowSourceCheck(root.command('workflows').command('source'))
  root.exitOverride()
  await root.parseAsync(['node', 'sim', 'workflows', 'source', 'check', '--dir', dir])
}
