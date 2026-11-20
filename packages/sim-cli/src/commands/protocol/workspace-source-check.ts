import { join } from 'node:path'
import { toRecord } from '@sim/utils/object'
import { KIND_DIRS } from '@sim/workspace-code'
import { WORKSPACE_BASE_FILE } from '@sim/workspace-code/layout'
import type { Command } from 'commander'
import { profileFrom } from '../../context'
import { AUTH_REQUIRED_CODE } from '../../exit-codes'
import { SimApiError } from '../../http/client'
import { apiCommand, type Connection } from '../../runtime/called-operations'
import { readSourceJson, SOURCE_DIR_BUSY_HELP, withSourceDirLock } from './source-dir'
import { unreachableReason } from './source-status'
import { cachedCatalog, loadCatalog, refreshWorkspaceTypes } from './source-tree'
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
  withWorkflowInputs,
  workspaceWorkflowInputs,
  workspaceWorkflowKeys,
} from './workflow-source-check'
import { assertWorkspaceDir, readWorkspaceDeclarations } from './workspace-source-dir'

const CHECK_HELP = `
Compiles every workflows/<key>/workflow.ts (and the function files each names) with the compiler
the server runs, against the workspace's block catalog the last get cached (in a fresh clone with
no cache, such as CI, it downloads the catalog once with the profile's credentials). No other
request is made. It checks, against what the directory declares:
  - env names (secrets.ts), with a did-you-mean
  - credential keys (credentials.ts)
  - the keys of tables, knowledge bases, skills, custom tools, MCP servers and workflows, with a
    did-you-mean, and a key holding a look-alike letter (a Cyrillic а) named by its code point
  - the columns and select options of a table row write
  - a child workflow call: an inputMapping key the child's Start trigger does not declare, and a
    child with no Start trigger
  - each tables/<key>.rows.jsonl: a malformed line, an undeclared column, a managed key two lines
    share, an empty required cell, a repeated unique value, a value its column's type or options
    cannot hold
  - block names whose words mix Latin with Cyrillic, Greek, Armenian or Cherokee letters
The dry run still checks what only the server knows (stored values, MCP tool names, model ids,
deployments, credential bindings), so run it before applying. A check also regenerates
.sim/sdk/workspace.d.ts from the declarations (so tsc types a key added since the get, and each
workflow's inputs) and adds the blocks the workflows now use to the CLI's tsconfig.json.

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
  try {
    return await loadCatalog(connection.client, { workspaceId, blockTypes: [] })
  } catch (error) {
    // No login keeps its own refusal (exit 13, naming `sim login`); a server that did not answer
    // leaves the catalog uncached, which the get that caches it fixes once the server answers.
    const reason =
      error instanceof SimApiError && error.code !== AUTH_REQUIRED_CODE
        ? unreachableReason(error)
        : null
    if (reason === null) throw error
    throw new SimApiError(
      `No block catalog is cached for workspace ${workspaceId}, and downloading it failed: ${reason} Run \`sim workspaces source get --dir ${dir}\` once the server can be reached, then check again.`,
      0,
      'CATALOG_NOT_CACHED'
    )
  }
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
    .addHelpText('after', `${CHECK_HELP}\n${SOURCE_DIR_BUSY_HELP}`)
    .action(async (options: { dir: string } & StrictOptions, command: Command) => {
      const profile = profileFrom(command)
      const base = toRecord(await readSourceJson(options.dir, WORKSPACE_BASE_FILE))
      await assertWorkspaceDir(options.dir)
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
        const workflowInputs = await workspaceWorkflowInputs(options.dir, catalog)
        const declarations = {
          ...(await readWorkspaceDeclarations(options.dir)),
          workflowInputs,
        }
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
        for (const {
          code,
          severity,
          message,
          hint,
          file,
          line,
          column,
        } of declarations.rowFindings) {
          findings.push({
            code,
            severity,
            message,
            ...(hint !== undefined ? { hint } : {}),
            file,
            line,
            column,
          })
        }
        await refreshWorkspaceTypes(
          options.dir,
          withWorkflowInputs(declarations.local, workflowInputs)
        )
        await refreshWorkspaceTsconfigs(options.dir, workspaceId)
        reportCheck(profile.output, findings, { workflows: keys.length, catalogHash: catalog.hash })
      })
    })
}
