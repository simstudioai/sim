import { join } from 'node:path'
import { toRecord } from '@sim/utils/object'
import { KIND_DIRS } from '@sim/workspace-code'
import { WORKSPACE_BASE_FILE } from '@sim/workspace-code/layout'
import type { Command } from 'commander'
import { profileFrom } from '../../context'
import { SimApiError } from '../../http/client'
import { apiCommand, type Connection } from '../../runtime/called-operations'
import { readSourceJson, withSourceDirLock } from './source-dir'
import { cachedCatalog, loadCatalog } from './source-tree'
import {
  type CheckFinding,
  checkWorkflowDir,
  refreshWorkspaceTsconfigs,
  reportCheck,
  requireCachedCatalog,
  STRICT_HELP,
  type StrictOptions,
  strictFlags,
  strictMode,
  workspaceWorkflowKeys,
} from './workflow-source-check'
import { readWorkspaceDeclarations } from './workspace-source-dir'

const CHECK_HELP = `
Compiles every workflows/<key>/workflow.ts (and the function files each names) with the compiler
the server runs, against the workspace's block catalog the last get cached (in a fresh clone with
no cache, such as CI, it downloads the catalog once with the profile's credentials), and checks each
against what the directory declares: env names (secrets.ts), credential keys (credentials.ts),
the keys of its tables, knowledge bases, custom tools, MCP servers and workflows, and the columns
and select options of a table row write. No other request is made. The dry run still checks what only
the server knows (stored values, resource files, deployment), so run it before applying. A check
also adds the blocks the workflows now use to the CLI's tsconfig.json, so tsc type-checks a block
an edit added.

${STRICT_HELP}`

/**
 * The workspace's catalog for a check with none cached (a fresh clone in CI), downloaded and
 * cached with the profile's credentials; without credentials, the refusal that names the get.
 */
async function fetchedCatalog(
  connect: () => Connection<'getSourceCatalog'>,
  workspaceId: string,
  dir: string
) {
  let connection: Connection<'getSourceCatalog'>
  try {
    connection = connect()
  } catch {
    return requireCachedCatalog(workspaceId, `\`sim workspaces source get --dir ${dir}\``)
  }
  return loadCatalog(connection.client, { workspaceId, blockTypes: [] })
}

/**
 * `sim workspaces source check [--dir <dir>]`: compiles every workflow of a workspace source
 * directory locally, each with the workspace's own declarations, so an agent's edit loop catches
 * an unknown key or column without the network. The dry run stays the authority.
 */
export function attachWorkspaceSourceCheck(source: Command): void {
  const [command, connect] = apiCommand(source, 'check', ['getSourceCatalog'])
  strictFlags(
    command.option(
      '--dir <dir>',
      `Workspace source directory: the kind folders and ${WORKSPACE_BASE_FILE}`,
      '.'
    )
  )
    .allowExcessArguments(false)
    .description(
      'Compile every workflow of a workspace source directory locally, without the server'
    )
    .addHelpText('after', CHECK_HELP)
    .action(async (options: { dir: string } & StrictOptions, command: Command) => {
      const profile = profileFrom(command)
      const base = toRecord(await readSourceJson(options.dir, WORKSPACE_BASE_FILE))
      const workspaceId =
        typeof base.workspaceId === 'string' ? base.workspaceId : profile.workspaceId
      if (!workspaceId) {
        throw new SimApiError(
          `${options.dir} has no ${WORKSPACE_BASE_FILE} and no workspace is selected: pass --workspace <workspaceId>.`,
          0
        )
      }
      await withSourceDirLock(options.dir, async () => {
        const catalog =
          cachedCatalog(workspaceId) ?? (await fetchedCatalog(connect, workspaceId, options.dir))
        const declarations = await readWorkspaceDeclarations(options.dir)
        const keys = await workspaceWorkflowKeys(options.dir)
        const findings: CheckFinding[] = []
        for (const key of keys) {
          const checked = await checkWorkflowDir(
            join(options.dir, KIND_DIRS.workflow, key),
            catalog,
            {
              declarations,
              strict: strictMode(options),
              prefix: `${KIND_DIRS.workflow}/${key}/`,
            }
          )
          findings.push(...checked.findings)
        }
        await refreshWorkspaceTsconfigs(options.dir, workspaceId)
        reportCheck(profile.output, findings, { workflows: keys.length, catalogHash: catalog.hash })
      })
    })
}
