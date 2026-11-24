import { SOURCE_BASE_FILE } from '@sim/workflow-code/limits'
import { KIND_DIRS } from '@sim/workspace-code'
import type { Command } from 'commander'
import { profileFrom } from '../../context'
import { CliUsageError } from './local-errors'
import {
  cachedOrRefuse,
  checkWorkflowDir,
  readCheckDeclarations,
  reportCheck,
  type StrictOptions,
  strictFlags,
  strictHelp,
  strictMode,
  typeCheckWorkspace,
} from './source-check'
import {
  absoluteDirOption,
  assertSourceDirKind,
  directoryWorkspace,
  recordedWorkspace,
  SOURCE_DIR_BUSY_HELP,
  withSourceCommandLock,
  workspaceFolderOf,
} from './source-dir'
import { cachedCatalog, cachedSourceCatalog, refreshTsconfigs } from './source-tree'
import { TYPES_HELP, type TypeCheck, type TypesOptions, typeCheck, typesFlag } from './source-types'
import { verboseFlag } from './source-ui'
import { requireEntry, WORKFLOW_TREE } from './workflow-dir'

const CHECK_HELP = `
Compiles workflow.ts (and the function files it names) with the compiler the server runs, against
the workspace's block catalog the last get or create cached, and prints the findings as the dry run
does. No request is made to Sim. It covers the source itself (syntax, builders, params, references,
wiring). In a workflow folder of a workspace directory (workflows/<key>), it reads the workspace's
.sim/base.json and also checks env names, resource keys and table columns against what the
directory declares. The dry run still checks what only the server knows (stored values,
deployment), so run it before applying. A check also adds the blocks the source now uses to the
CLI's tsconfig.json, so a block the edit added is typed; in a workspace directory it also
regenerates .sim/sdk/workspace.d.ts from the files, so each key and workflow input they declare is.
${TYPES_HELP}

${strictHelp('no cached catalog (run the get once)')}`

/**
 * `sim workflows source check [--dir <dir>]`: compiles a source directory locally with the bundled
 * compiler and the cached catalog, so an agent's edit loop gets syntax and builder findings in
 * milliseconds and without the network. The dry run stays the authority.
 */
export function attachWorkflowSourceCheck(source: Command): void {
  verboseFlag(
    typesFlag(
      strictFlags(
        absoluteDirOption(source.command('check')).option(
          '--dir <dir>',
          'Source directory: workflow.ts, functions/* and .sim/',
          '.'
        )
      )
    )
  )
    .allowExcessArguments(false)
    .description('Compile and type-check a workflow source directory locally, without the server')
    .addHelpText('after', `${CHECK_HELP}\n${SOURCE_DIR_BUSY_HELP}`)
    .action(
      async (
        options: { dir: string; verbose?: boolean } & StrictOptions & TypesOptions,
        command: Command
      ) => {
        const profile = profileFrom(command)
        await assertSourceDirKind(options.dir, 'workflow')
        await requireEntry(options.dir)
        const workspace = await workspaceFolderOf(options.dir)
        const workspaceId = directoryWorkspace(
          options.dir,
          await recordedWorkspace(options.dir, profile),
          profile,
          (from, _named, setting) =>
            `Run it without ${setting} to check it against the catalog of ${from}.`
        )
        if (!workspaceId) {
          throw new CliUsageError(
            `${options.dir} has no ${SOURCE_BASE_FILE} and no workspace is selected: pass --workspace <workspaceId>.`
          )
        }
        // A check rewrites the types and tsconfig files, so it holds the lock an apply or get
        // takes: it never reads a directory one is halfway through rewriting (exit 10 meanwhile).
        await withSourceCommandLock(
          options.dir,
          async () => {
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
            const enabled = options.types !== false
            let types: TypeCheck
            if (workspace && declarations) {
              types = await typeCheckWorkspace(workspace.root, workspaceId, declarations, {
                enabled,
                compiled: findings,
                scope: `${KIND_DIRS.workflow}/${workspace.key}/`,
              })
            } else {
              await refreshTsconfigs(
                options.dir,
                workspaceId,
                WORKFLOW_TREE,
                { sources: [entry] },
                { incremental: true }
              )
              types = await typeCheck(options.dir, { enabled, compiled: findings })
            }
            reportCheck(
              profile.output,
              findings,
              { catalogHash: catalog.hash },
              {
                verbose: options.verbose === true,
                unlisted,
                dir: options.dir,
                types,
              }
            )
          },
          { readOnly: true }
        )
      }
    )
}
