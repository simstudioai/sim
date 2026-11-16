import { mkdir, readFile } from 'node:fs/promises'
import { dirname, posix, resolve } from 'node:path'
import type { Command } from 'commander'
import { printError } from '#sim-cli/output/io'
import { embedStore, setSoftExitCode } from '../../embed-context'
import type { ApplyWorkflowSourceBody, ApplyWorkflowSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand } from '../../runtime/called-operations'
import { embeddedFileContent } from '../../transfer/local-file'
import { saveToFile } from './files-get'
import { printProtocolResult } from './result'

/** The layout `workflows source get` writes and this command reads back. */
const ENTRY_FILE = 'workflow.ts'
const LOCK_FILE = '.sim/lock.json'
const BASE_FILE = '.sim/base.json'
/** `code: file('./functions/x.js')` in the entry file (the SDK's only code-file form). */
const CODE_FILE_REFERENCE = /\bfile\(\s*(['"])([^'"\n]+)\1\s*\)/g

type Diagnostic = ApplyWorkflowSourceResponse['data']['diagnostics'][number]

interface SourceApplyOptions {
  from: string
  dryRun?: boolean
}

/** A path inside the source directory, refusing absolute paths and `..` escapes. */
function sourceRelativePath(path: string): string | null {
  const normalized = posix.normalize(path.replace(/\\/g, '/'))
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) return null
  return normalized.startsWith('./') ? normalized.slice(2) : normalized
}

function locate(directory: string, path: string): string {
  return embedStore.getStore() ? posix.join(directory, path) : resolve(directory, path)
}

async function readText(directory: string, path: string): Promise<string> {
  const target = locate(directory, path)
  const embedded = embedStore.getStore()
  if (embedded) {
    const content = await embeddedFileContent(embedded, target)
    return typeof content === 'string' ? content : new TextDecoder().decode(content)
  }
  try {
    return await readFile(target, 'utf8')
  } catch (error) {
    throw new SimApiError(`Cannot read ${target}: ${(error as Error).message}`, 0)
  }
}

async function readJson(directory: string, path: string, hint: string): Promise<unknown> {
  const text = await readText(directory, path).catch((error: unknown) => {
    throw new SimApiError(`${(error as Error).message}. ${hint}`, 0)
  })
  try {
    return JSON.parse(text)
  } catch {
    throw new SimApiError(`${locate(directory, path)} is not valid JSON. ${hint}`, 0)
  }
}

async function writeText(directory: string, path: string, text: string): Promise<void> {
  const target = locate(directory, path)
  if (!embedStore.getStore()) await mkdir(dirname(target), { recursive: true })
  await saveToFile(new Blob([text]).stream(), target, true)
}

/**
 * The function-code files the source can reference: every `file('…')` in the entry file plus
 * every `codeFile` the lock records. Only those are sent; the server reports a referenced file
 * that is missing.
 */
function codeFilePaths(entry: string, lock: ApplyWorkflowSourceBody['lock']): string[] {
  const paths = new Set<string>()
  for (const match of entry.matchAll(CODE_FILE_REFERENCE)) {
    const path = sourceRelativePath(match[2])
    if (path) paths.add(path)
  }
  for (const block of Object.values(lock.blocks)) {
    const path = block.codeFile ? sourceRelativePath(block.codeFile) : null
    if (path) paths.add(path)
  }
  paths.delete(ENTRY_FILE)
  return [...paths]
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  const where =
    diagnostic.file !== undefined
      ? `${diagnostic.file}:${diagnostic.line ?? 1}:${diagnostic.column ?? 1} `
      : diagnostic.path !== undefined
        ? `${LOCK_FILE}#${diagnostic.path} `
        : ''
  const lines = [`${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`]
  if (diagnostic.frame) lines.push(diagnostic.frame)
  if (diagnostic.hint) lines.push(`  hint: ${diagnostic.hint}`)
  return lines.join('\n')
}

function isDiagnosticList(value: unknown): value is Diagnostic[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'object' && item !== null && 'code' in item)
  )
}

/**
 * `sim workflows source apply <workflowId> --from <dir>`: sends a source directory written by
 * `workflows source get` (`workflow.ts`, its function-code files, `.sim/lock.json` and
 * `.sim/base.json`) and, after a successful write, saves the re-printed files, the new lock and
 * the new base back into it, so the next apply starts from what was stored.
 */
export function attachWorkflowSourceApply(source: Command): void {
  const [command, connectApply] = apiCommand(source, 'apply', ['applyWorkflowSource'], {
    runs: 'applyWorkflowSource',
  })
  command
    .argument('<workflowId>', 'Workflow whose draft the source replaces')
    .requiredOption(
      '--from <dir>',
      'Source directory: workflow.ts, functions/*, .sim/lock.json and .sim/base.json'
    )
    .option('--dry-run', 'Check the source and show the outcome without saving or writing files')
    .allowExcessArguments(false)
    .description('Apply a workflow source directory to the workflow draft')
    .action(async (workflowId: string, options: SourceApplyOptions) => {
      const { client, profile } = connectApply()
      const directory = options.from
      const hint = 'Write the directory with `sim workflows source get` first.'
      const entry = await readText(directory, ENTRY_FILE)
      const lock = (await readJson(directory, LOCK_FILE, hint)) as ApplyWorkflowSourceBody['lock']
      const lockBase = (await readJson(directory, BASE_FILE, hint)) as NonNullable<
        ApplyWorkflowSourceBody['lockBase']
      >
      if (typeof lockBase?.baseFingerprint !== 'string') {
        throw new SimApiError(`${locate(directory, BASE_FILE)} has no baseFingerprint. ${hint}`, 0)
      }

      const files: Record<string, string> = { [ENTRY_FILE]: entry }
      for (const path of codeFilePaths(entry, lock)) {
        try {
          files[path] = await readText(directory, path)
        } catch {
          // A referenced file that is missing is reported by the server with its source line.
        }
      }

      let response: ApplyWorkflowSourceResponse
      try {
        response = await client.request<ApplyWorkflowSourceResponse>('applyWorkflowSource', {
          params: { workflowId },
          ...(options.dryRun ? { query: { dryRun: true } } : {}),
          body: {
            files,
            lock,
            lockBase,
            baseFingerprint: lockBase.baseFingerprint,
            provenance: { client: 'cli' },
          } satisfies ApplyWorkflowSourceBody,
        })
      } catch (error) {
        if (error instanceof SimApiError && error.details && typeof error.details === 'object') {
          const diagnostics = (error.details as { diagnostics?: unknown }).diagnostics
          if (isDiagnosticList(diagnostics)) {
            for (const diagnostic of diagnostics) printError(formatDiagnostic(diagnostic))
            throw new SimApiError(error.message, error.status, error.code, undefined)
          }
        }
        throw error
      }

      const { data } = response
      for (const diagnostic of data.diagnostics) printError(formatDiagnostic(diagnostic))
      const refused = data.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      if (refused) setSoftExitCode(1)

      if (!data.dryRun && !refused) {
        for (const [path, text] of Object.entries(data.files)) {
          const relative = sourceRelativePath(path)
          if (!relative) throw new SimApiError(`Refusing to write ${path} outside ${directory}`, 0)
          await writeText(directory, relative, text)
        }
        await writeText(directory, LOCK_FILE, `${JSON.stringify(data.lock, null, 2)}\n`)
        await writeText(directory, BASE_FILE, `${JSON.stringify(data.lockBase, null, 2)}\n`)
      }

      printProtocolResult(profile.output, {
        workflowId: data.workflowId,
        applied: data.applied,
        dryRun: data.dryRun,
        noop: data.diff.noop,
        blocksAdded: data.diff.blocks.added.length,
        blocksRemoved: data.diff.blocks.removed.length,
        blocksModified: data.diff.blocks.modified.length,
        edgesAdded: data.diff.edges.added,
        edgesRemoved: data.diff.edges.removed,
        errors: data.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
        warnings:
          data.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length +
          data.warnings.length,
        newFingerprint: data.newFingerprint,
        needsRedeployment: data.needsRedeployment,
      })
    })
}
