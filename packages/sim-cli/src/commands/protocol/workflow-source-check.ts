import { toRecord } from '@sim/utils/object'
import { compileWorkflow, parseWorkflowLock } from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import type { Command } from 'commander'
import { profileFrom } from '../../context'
import { setSoftExitCode } from '../../embed-context'
import { SimApiError } from '../../http/client'
import { printProtocolResult } from './result'
import { readSourceJson } from './source-dir'
import { cachedCatalog } from './source-tree'
import { printNewDiagnostics } from './source-ui'
import { readSourceFiles } from './workflow-source-apply'

/**
 * A finding only the server can decide: `stored()` keeps a secret the stored workflow holds, and
 * a local compile has no stored workflow to read it from.
 */
const SERVER_ONLY_CODES: ReadonlySet<string> = new Set(['E_STORED_VALUE_MISSING'])

const CHECK_HELP = `
Compiles workflow.ts (and the function files it names) with the compiler the server runs, against
the workspace's block catalog the last get or create cached, and prints the findings as the dry run
does. No request is made. It covers the source itself (syntax, builders, params, references,
wiring); the dry run still checks what only the server knows (resource keys, credentials, stored
values, deployment), so run it before applying.

Exit codes: 0 no errors; 1 errors (each printed as file:line:column with its frame and hint), or
no cached catalog (run \`sim workflows source get\` once).`

/**
 * `sim workflows source check [--dir <dir>]`: compiles a source directory locally with the bundled
 * compiler and the cached catalog, so an agent's edit loop gets syntax and builder findings in
 * milliseconds and without the network. The dry run stays the authority.
 */
export function attachWorkflowSourceCheck(source: Command): void {
  source
    .command('check')
    .option('--dir <dir>', 'Source directory: workflow.ts, functions/* and .sim/', '.')
    .allowExcessArguments(false)
    .description('Compile a workflow source directory locally, without the server')
    .addHelpText('after', CHECK_HELP)
    .action(async (options: { dir: string }, command: Command) => {
      const profile = profileFrom(command)
      const base = toRecord(await readSourceJson(options.dir, SOURCE_BASE_FILE))
      const workspaceId =
        typeof base.workspaceId === 'string' ? base.workspaceId : profile.workspaceId
      if (!workspaceId) {
        throw new SimApiError(
          `${options.dir} has no ${SOURCE_BASE_FILE} and no workspace is selected: pass --workspace <workspaceId>.`,
          0
        )
      }
      const catalog = cachedCatalog(workspaceId)
      if (!catalog) {
        throw new SimApiError(
          `No block catalog is cached for workspace ${workspaceId}. Run \`sim workflows source get <workflowId> --dir ${options.dir}\` (or \`create\`) once, then check again.`,
          0,
          'CATALOG_NOT_CACHED'
        )
      }
      const { lock } = parseWorkflowLock(await readSourceJson(options.dir, SOURCE_LOCK_FILE))
      const files = await readSourceFiles(options.dir, lock ?? null)
      const compiled = compileWorkflow({
        entry: { path: SOURCE_ENTRY_FILE, text: files[SOURCE_ENTRY_FILE] },
        files: new Map(Object.entries(files).filter(([path]) => path !== SOURCE_ENTRY_FILE)),
        catalog,
        sdkMajor: catalog.sdkMajor,
        knownKeys: new Set(Object.keys(lock?.blocks ?? {})),
      })
      const diagnostics = compiled.diagnostics
        .filter((diagnostic) => !SERVER_ONLY_CODES.has(diagnostic.code))
        .map(({ code, severity, message, hint, frame, span }) => ({
          code,
          severity,
          message,
          ...(hint !== undefined ? { hint } : {}),
          ...(frame !== undefined ? { frame } : {}),
          ...(span ? { file: span.file, line: span.line, column: span.column } : {}),
        }))
      printNewDiagnostics(diagnostics, new Set())
      const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length
      if (errors > 0) setSoftExitCode(1)
      printProtocolResult(profile.output, {
        checked: 'compile',
        errors,
        warnings: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
        catalogHash: catalog.hash,
      })
    })
}
