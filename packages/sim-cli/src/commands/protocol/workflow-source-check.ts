import { toRecord } from '@sim/utils/object'
import { SOURCE_BASE_FILE } from '@sim/workflow-code/limits'
import type { Command } from 'commander'
import { profileFrom } from '../../context'
import { CliUsageError } from './local-errors'
import {
  cachedOrRefuse,
  checkWorkflowDir,
  readCheckDeclarations,
  refreshWorkspaceTsconfigs,
  reportCheck,
  STRICT_HELP,
  type StrictOptions,
  strictFlags,
  strictMode,
  withWorkflowInputs,
} from './source-check'
import {
  absoluteDirOption,
  assertSourceDirKind,
  directoryWorkspace,
  readSourceJson,
  readStarterWorkspace,
  workspaceFolderOf,
} from './source-dir'
import {
  cachedCatalog,
  cachedSourceCatalog,
  refreshTsconfigs,
  refreshWorkspaceTypes,
} from './source-tree'
import { verboseFlag } from './source-ui'
import { requireEntry, WORKFLOW_TREE } from './workflow-dir'

const CHECK_HELP = `
Compiles workflow.ts (and the function files it names) with the compiler the server runs, against
the workspace's block catalog the last get or create cached, and prints the findings as the dry run
does. No request is made. It covers the source itself (syntax, builders, params, references,
wiring). In a workflow folder of a workspace directory (workflows/<key>), it reads the workspace's
.sim/base.json and also checks env names, resource keys and table columns against what the
directory declares. The dry run still checks what only the server knows (stored values,
deployment), so run it before applying. A check also adds the blocks the source now uses to the
CLI's tsconfig.json, so tsc type-checks a block the edit added; in a workspace directory it also
regenerates .sim/sdk/workspace.d.ts, so tsc types each workflow's inputs as its files declare them.

${STRICT_HELP}`

/**
 * `sim workflows source check [--dir <dir>]`: compiles a source directory locally with the bundled
 * compiler and the cached catalog, so an agent's edit loop gets syntax and builder findings in
 * milliseconds and without the network. The dry run stays the authority.
 */
export function attachWorkflowSourceCheck(source: Command): void {
  verboseFlag(
    strictFlags(
      absoluteDirOption(source.command('check')).option(
        '--dir <dir>',
        'Source directory: workflow.ts, functions/* and .sim/',
        '.'
      )
    )
  )
    .allowExcessArguments(false)
    .description('Compile a workflow source directory locally, without the server')
    .addHelpText('after', CHECK_HELP)
    .action(
      async (options: { dir: string; verbose?: boolean } & StrictOptions, command: Command) => {
        const profile = profileFrom(command)
        await assertSourceDirKind(options.dir, 'workflow')
        const base = toRecord(await readSourceJson(options.dir, SOURCE_BASE_FILE))
        await requireEntry(options.dir)
        const workspace = await workspaceFolderOf(options.dir)
        const recorded =
          typeof base.workspaceId === 'string'
            ? base.workspaceId
            : (workspace?.workspaceId ??
              (profile.sources.workspaceId === 'flag'
                ? null
                : await readStarterWorkspace(options.dir)))
        const workspaceId = directoryWorkspace(
          options.dir,
          recorded,
          profile,
          (from) => `Run it without --workspace to check it against the catalog of ${from}.`
        )
        if (!workspaceId) {
          throw new CliUsageError(
            `${options.dir} has no ${SOURCE_BASE_FILE} and no workspace is selected: pass --workspace <workspaceId>.`
          )
        }
        const catalog = cachedOrRefuse(
          (await cachedSourceCatalog(options.dir)) ?? cachedCatalog(workspaceId),
          workspaceId,
          workspace
            ? `\`sim workspaces source get --dir ${workspace.root}\``
            : `\`sim workflows source get <workflowId> --dir ${options.dir}\` (or \`create\`)`
        )
        const declarations = workspace
          ? await readCheckDeclarations(workspace.root, catalog)
          : undefined
        const { findings, entry, unlisted } = await checkWorkflowDir(options.dir, catalog, {
          strict: strictMode(options),
          ...(declarations ? { declarations } : {}),
        })
        if (workspace && declarations) {
          await refreshWorkspaceTypes(
            workspace.root,
            withWorkflowInputs(declarations.local, declarations.workflowInputs)
          )
          await refreshWorkspaceTsconfigs(workspace.root, workspaceId)
        } else {
          await refreshTsconfigs(
            options.dir,
            workspaceId,
            WORKFLOW_TREE,
            { sources: [entry] },
            { incremental: true }
          )
        }
        reportCheck(
          profile.output,
          findings,
          { catalogHash: catalog.hash },
          {
            verbose: options.verbose === true,
            unlisted,
            dir: options.dir,
          }
        )
      }
    )
}
