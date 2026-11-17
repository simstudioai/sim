import { Command } from 'commander'
import { attachWorkspaceSourceApply } from '../commands/protocol/workspace-source-apply'
import { attachWorkspaceSourceGet } from '../commands/protocol/workspace-source-get'

/**
 * Parses `sim workspaces source <command> --dir <dir> ...argv` through the real commander wiring,
 * with exits thrown instead of ending the process.
 */
export async function runWorkspaceSource(
  command: 'get' | 'apply',
  dir: string,
  ...argv: string[]
): Promise<void> {
  const root = new Command('sim')
  const source = root.command('workspaces').command('source')
  if (command === 'get') attachWorkspaceSourceGet(source)
  else attachWorkspaceSourceApply(source)
  root.exitOverride()
  await root.parseAsync(['node', 'sim', 'workspaces', 'source', command, '--dir', dir, ...argv])
}
