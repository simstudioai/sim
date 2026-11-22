import { toRecord } from '@sim/utils/object'
import type { BlockCatalog } from '@sim/workflow-code'
import { SOURCE_BASE_FILE } from '@sim/workflow-code/limits'
import { lookupBuilder, renderBuilderReference } from '@sim/workflow-sdk/codegen'
import type { Command } from 'commander'
import { printLine } from '#sim-cli/output/io'
import { profileFrom } from '../../context'
import { CliUsageError, SourceDirError } from './local-errors'
import { printProtocolResult } from './result'
import { readSourceJson, workspaceFolderOf } from './source-dir'
import { cachedCatalog, cachedSourceCatalog } from './source-tree'
import { isMachine } from './source-ui'

const PARAMS_HELP = `
Prints a builder's params (required first, with enums and defaults), the gate field that picks
which others apply, and its outputs, from the block catalog the last get, create or check cached.
No request is made. <builder> is the dotted builder path as source writes it: table.upsertRow,
agent, trigger.schedule, slack.sendMessage (slack.tool.sendMessage names the same builder). A
namespace (gmail, trigger.gmail) lists its builders; a block type prints the builder written for
it (function is fn) or lists them (table_v2); a construct core.d.ts declares (loop, parallel, t,
env) prints its declaration. Run it from a workflow or workspace source directory,
or pass --dir.

Exit codes: 0 printed; 1 no builder or namespace of that name (the closest one is named), or no
cached catalog (run a get once).`

/**
 * The catalog the directory was printed with (its `.sim/base.json` hash), else the one cached for
 * its workspace, the workspace a workflow folder belongs to, or the profile's.
 */
async function lookupCatalog(dir: string, profileWorkspace: string | null): Promise<BlockCatalog> {
  const printedWith = await cachedSourceCatalog(dir)
  if (printedWith) return printedWith
  const base = toRecord(await readSourceJson(dir, SOURCE_BASE_FILE))
  const workspaceId =
    typeof base.workspaceId === 'string'
      ? base.workspaceId
      : ((await workspaceFolderOf(dir))?.workspaceId ?? profileWorkspace)
  const cached = workspaceId ? cachedCatalog(workspaceId) : null
  if (cached) return cached
  throw new SourceDirError(
    workspaceId
      ? `No block catalog is cached for workspace ${workspaceId}. Run \`sim workflows source get <workflowId> --dir <dir>\` (or \`sim workspaces source get --dir <dir>\`) once, then look it up again.`
      : `${dir} is not a source directory and no workspace is selected: pass --dir <source dir> or --workspace <workspaceId>.`,
    { code: 'CATALOG_NOT_CACHED' }
  )
}

/**
 * `sim workflows source params <builder> [--dir <dir>]`: one builder's params and outputs from the
 * cached catalog, so an agent reads the shape of a block it is about to write in one command
 * instead of searching the declarations.
 */
export function attachWorkflowSourceParams(source: Command): void {
  source
    .command('params')
    .argument('<builder>', 'Builder path (table.upsertRow, agent, trigger.schedule) or namespace')
    .option('--dir <dir>', 'Source directory whose catalog to read', '.')
    .allowExcessArguments(false)
    .description("Print a builder's params and outputs from the cached block catalog (offline)")
    .addHelpText('after', PARAMS_HELP)
    .action(async (query: string, options: { dir: string }, command: Command) => {
      const profile = profileFrom(command)
      const catalog = await lookupCatalog(options.dir, profile.workspaceId)
      const found = lookupBuilder(catalog, query)
      const machine = isMachine(profile.output)
      switch (found.kind) {
        case 'builder':
          if (machine) printProtocolResult(profile.output, { builder: found.reference })
          else printLine(renderBuilderReference(found.reference))
          return
        case 'namespace':
          if (machine) printProtocolResult(profile.output, found)
          else {
            printLine(`${found.namespace} has ${found.builders.length} builders:`)
            for (const builder of found.builders) printLine(`  ${builder.key} — ${builder.summary}`)
          }
          return
        case 'core':
          if (machine) printProtocolResult(profile.output, found)
          else printLine(`${found.name} is declared in .sim/sdk/core.d.ts:\n\n${found.declaration}`)
          return
        case 'missing':
          throw new CliUsageError(
            `No builder or namespace is named ${query}.${found.hint ? ` ${found.hint}` : ''}`,
            { code: 'BUILDER_UNKNOWN' }
          )
      }
    })
}
