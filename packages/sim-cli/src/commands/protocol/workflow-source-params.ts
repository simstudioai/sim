import type { BlockCatalog } from '@sim/workflow-code'
import {
  compactBuilder,
  lookupBuilder,
  renderBuilderReference,
  renderCompactBuilder,
} from '@sim/workflow-sdk/codegen'
import type { Command } from 'commander'
import { printLine } from '#sim-cli/output/io'
import type { ResolvedProfile } from '../../config/index'
import { actingProfileFrom } from '../../context'
import { CliUsageError, SourceDirError } from './local-errors'
import { printProtocolResult } from './result'
import { recordedWorkspace } from './source-dir'
import { cachedCatalog, cachedSourceCatalog } from './source-tree'
import { isMachine } from './source-ui'

const PARAMS_HELP = `
Prints a builder in brief (an example call, the required params with types, the optional ones by
name, the gate field that picks which others apply, and the outputs), from the block catalog the
last get, create or check cached. --full prints every param with its type, enum, default and doc.
A legacy builder names the one that replaces it. No request is made.
<builder> is the dotted builder path as source writes it: table.upsertRow, agent, trigger.schedule,
slack.sendMessage (slack.tool.sendMessage names the same builder). A namespace (gmail,
trigger.gmail) lists its builders; a block type prints the builder written for it (function is fn)
or lists them (table_v2); a construct core.d.ts declares (loop, parallel, t, env) prints its
declaration. Run it from a workflow or workspace source directory, or pass --dir.

Exit codes: 0 printed; 1 no builder or namespace of that name (the closest one is named), or no
cached catalog (run a get once).`

/**
 * The catalog the directory was printed with (its `.sim/base.json` hash), else the one cached for
 * the workspace it records ({@link recordedWorkspace}), or the profile's.
 */
async function lookupCatalog(
  dir: string,
  profile: Pick<ResolvedProfile, 'workspaceId' | 'sources'>
): Promise<BlockCatalog> {
  const printedWith = await cachedSourceCatalog(dir)
  if (printedWith) return printedWith
  const workspaceId = (await recordedWorkspace(dir, profile)) ?? profile.workspaceId
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
 * `sim workflows source params <builder> [--dir <dir>] [--full]`: one builder in brief, or with
 * every param's docs under `--full`, from the
 * cached catalog, so an agent reads the shape of a block it is about to write in one command
 * instead of searching the declarations.
 */
export function attachWorkflowSourceParams(source: Command): void {
  source
    .command('params')
    .argument('<builder>', 'Builder path (table.upsertRow, agent, trigger.schedule) or namespace')
    .option('--dir <dir>', 'Source directory whose catalog to read', '.')
    .option('--full', 'Print every param with its type, enum, default and doc, not the brief form')
    .allowExcessArguments(false)
    .description("Print a builder's params and outputs from the cached block catalog (offline)")
    .addHelpText('after', PARAMS_HELP)
    .action(async (query: string, options: { dir: string; full?: boolean }, command: Command) => {
      const profile = actingProfileFrom(command)
      const catalog = await lookupCatalog(options.dir, profile)
      const found = lookupBuilder(catalog, query)
      const machine = isMachine(profile.output)
      switch (found.kind) {
        case 'builder':
          if (machine) {
            const builder = options.full ? found.reference : compactBuilder(found.reference)
            printProtocolResult(profile.output, { builder })
          } else {
            printLine(
              (options.full ? renderBuilderReference : renderCompactBuilder)(found.reference)
            )
          }
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
