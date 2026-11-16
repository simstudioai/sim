import { mkdir, readFile } from 'node:fs/promises'
import { dirname, posix, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import type { Command } from 'commander'
import { printError } from '#sim-cli/output/io'
import { embedStore, setSoftExitCode } from '../../embed-context'
import type {
  ApplyWorkflowSourceBody,
  ApplyWorkflowSourceResponse,
  CreateWorkflowFromSourceBody,
} from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand } from '../../runtime/called-operations'
import { embeddedFileContent } from '../../transfer/local-file'
import { saveToFile } from './files-get'
import { printProtocolResult } from './result'
import {
  SOURCE_BASE_FILE as BASE_FILE,
  SOURCE_ENTRY_FILE as ENTRY_FILE,
  SOURCE_LOCK_FILE as LOCK_FILE,
} from './workflow-source-layout'

/** `code: codeFile('./functions/x.js')` in the entry file (the SDK's only code-file form). */
const CODE_FILE_REFERENCE = /\bcodeFile\(\s*(['"])([^'"\n]+)\1\s*\)/g

type SourceApplyData = ApplyWorkflowSourceResponse['data']
type Diagnostic = SourceApplyData['diagnostics'][number]
type SourceLock = ApplyWorkflowSourceBody['lock']

interface SourceWriteOptions {
  dir: string
  dryRun?: boolean
  yes?: boolean
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
 * The function-code files the source can reference: every `codeFile('…')` in the entry file plus
 * every `codeFile` the lock records. Only those are sent; the server reports a referenced file
 * that is missing.
 */
function codeFilePaths(entry: string, lock: SourceLock | null): string[] {
  const paths = new Set<string>()
  for (const match of entry.matchAll(CODE_FILE_REFERENCE)) {
    const path = sourceRelativePath(match[2])
    if (path) paths.add(path)
  }
  for (const block of Object.values(lock?.blocks ?? {})) {
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

/** One line naming what the apply changes, shown before asking to confirm it. */
function diffSummary(data: SourceApplyData): string {
  const { blocks, edges, variables } = data.diff
  if (data.diff.noop) return 'No graph changes (names, order or comments may still be saved).'
  const parts = [
    `${blocks.added.length} added`,
    `${blocks.removed.length} removed`,
    `${blocks.renamed.length} renamed`,
    `${blocks.modified.length} modified`,
  ]
  const variableCount =
    variables.added.length + variables.removed.length + variables.modified.length
  return `Blocks: ${parts.join(', ')}. Connections: +${edges.added} -${edges.removed}.${
    variableCount > 0 ? ` Variables changed: ${variableCount}.` : ''
  }`
}

/** Whether a person is at a terminal to answer a prompt: never for an embedded run. */
function canPrompt(): boolean {
  return !embedStore.getStore() && process.stdin.isTTY === true && process.stderr.isTTY === true
}

async function confirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = (await prompt.question(`${question} (y/N) `)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    prompt.close()
  }
}

interface SourceSubmission {
  files: Record<string, string>
  lock: SourceLock | null
  base: ApplyWorkflowSourceBody['base'] | null
}

/** Reads the directory: the entry file, its code files and, unless creating, the lock files. */
async function readSubmission(directory: string, creating: boolean): Promise<SourceSubmission> {
  const hint = 'Write the directory with `sim workflows source get` first.'
  const entry = await readText(directory, ENTRY_FILE)
  let lock: SourceLock | null = null
  let base: SourceSubmission['base'] = null
  if (!creating) {
    lock = (await readJson(directory, LOCK_FILE, hint)) as SourceLock
    base = (await readJson(directory, BASE_FILE, hint)) as ApplyWorkflowSourceBody['base']
    if (typeof base?.fingerprint !== 'string') {
      throw new SimApiError(`${locate(directory, BASE_FILE)} has no fingerprint. ${hint}`, 0)
    }
  }
  const files: Record<string, string> = { [ENTRY_FILE]: entry }
  for (const path of codeFilePaths(entry, lock)) {
    try {
      files[path] = await readText(directory, path)
    } catch {
      // A referenced file that is missing is reported by the server with its source line.
    }
  }
  return { files, lock, base }
}

/** Re-throws an API refusal after printing its diagnostics, so each shows its source line. */
function printRefusal(error: unknown): never {
  if (error instanceof SimApiError && error.details && typeof error.details === 'object') {
    const diagnostics = (error.details as { diagnostics?: unknown }).diagnostics
    if (isDiagnosticList(diagnostics)) {
      for (const diagnostic of diagnostics) printError(formatDiagnostic(diagnostic))
      throw new SimApiError(error.message, error.status, error.code, undefined)
    }
  }
  throw error
}

/**
 * The shared write flow of `apply` and `create`: refuse a write without consent when no terminal
 * can ask, preview and ask on a terminal, send, print the diagnostics, and after a successful
 * write save the re-printed files, the lock and the base back into the directory.
 */
async function runSourceWrite(args: {
  directory: string
  options: SourceWriteOptions
  creating: boolean
  question: string
  send: (dryRun: boolean) => Promise<SourceApplyData>
  output: Parameters<typeof printProtocolResult>[0]
}): Promise<void> {
  const { directory, options, creating, send } = args
  if (!options.dryRun && !options.yes) {
    const preview = await send(true)
    for (const diagnostic of preview.diagnostics) printError(formatDiagnostic(diagnostic))
    if (preview.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      setSoftExitCode(1)
      printProtocolResult(args.output, summarize(preview, creating))
      return
    }
    printError(diffSummary(preview))
    if (!(await confirm(args.question))) {
      throw new SimApiError('Nothing was applied.', 0, 'CANCELLED')
    }
  }

  const data = await send(options.dryRun === true)
  for (const diagnostic of data.diagnostics) printError(formatDiagnostic(diagnostic))
  const refused = data.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  if (refused) setSoftExitCode(1)

  if (!data.dryRun && !refused && (data.applied || !creating)) {
    for (const [path, text] of Object.entries(data.files)) {
      const relative = sourceRelativePath(path)
      if (!relative) throw new SimApiError(`Refusing to write ${path} outside ${directory}`, 0)
      await writeText(directory, relative, text)
    }
    await writeText(directory, LOCK_FILE, `${JSON.stringify(data.lock, null, 2)}\n`)
    await writeText(directory, BASE_FILE, `${JSON.stringify(data.base, null, 2)}\n`)
  }

  printProtocolResult(args.output, summarize(data, creating))
}

/** A write without `--yes` or `--dry-run` where no terminal can ask: the generic refusal. */
function requireConsent(options: SourceWriteOptions, action: string): void {
  if (!options.dryRun && !options.yes && !canPrompt()) {
    throw new SimApiError(
      `This ${action}. Re-run with --yes to apply it, or with --dry-run to check it without writing.`,
      0,
      'CONFIRMATION_REQUIRED'
    )
  }
}

const DIR_DESCRIPTION =
  'Source directory: workflow.ts, functions/*, .sim/lock.json and .sim/base.json'

/**
 * `sim workflows source apply <workflowId> --dir <dir>`: sends a source directory written by
 * `workflows source get` (`workflow.ts`, its function-code files, `.sim/lock.json` and
 * `.sim/base.json`) and, after a successful write, saves the re-printed files, the new lock and
 * the new base back into it, so the next apply starts from what was stored.
 *
 * Writing needs consent: on a terminal it shows the dry-run outcome and asks; anywhere else it
 * needs `--yes`. `--dry-run` writes nothing, so it never asks.
 */
export function attachWorkflowSourceApply(source: Command): void {
  const [command, connectApply] = apiCommand(source, 'apply', ['applyWorkflowSource'])
  command
    .argument('<workflowId>', 'Workflow whose draft the source replaces')
    .requiredOption('--dir <dir>', DIR_DESCRIPTION)
    .option('--dry-run', 'Check the source and show the outcome without saving or writing files')
    .option('-y, --yes', 'Apply without asking for confirmation')
    .allowExcessArguments(false)
    .description('Apply a workflow source directory to a workflow draft')
    .action(async (workflowId: string, options: SourceWriteOptions) => {
      requireConsent(options, 'writes the workflow draft')
      const { client, profile } = connectApply()
      const submission = await readSubmission(options.dir, false)
      const { lock, base } = submission
      if (!lock || !base)
        throw new SimApiError('The source directory has no lock to apply with.', 0)
      await runSourceWrite({
        directory: options.dir,
        options,
        creating: false,
        question: `Apply these changes to workflow ${workflowId}?`,
        output: profile.output,
        send: async (dryRun) => {
          try {
            const response = await client.request<ApplyWorkflowSourceResponse>(
              'applyWorkflowSource',
              {
                params: { workflowId },
                ...(dryRun ? { query: { dryRun: true } } : {}),
                body: {
                  files: submission.files,
                  lock,
                  base,
                  provenance: { client: 'cli' },
                } satisfies ApplyWorkflowSourceBody,
              }
            )
            return response.data
          } catch (error) {
            return printRefusal(error)
          }
        },
      })
    })
}

/**
 * `sim workflows source create --dir <dir>`: creates a workflow from the directory's
 * `workflow.ts`, then writes the new workflow's re-printed files and lock files into the
 * directory. Same consent rule as `apply`.
 */
export function attachWorkflowSourceCreate(source: Command): void {
  const [command, connectCreate] = apiCommand(source, 'create', ['createWorkflowFromSource'])
  command
    .requiredOption('--dir <dir>', 'Source directory: workflow.ts and functions/*')
    .option('--dry-run', 'Check the source and show the outcome without creating anything')
    .option('--name <name>', "The workflow name (default: the source's)")
    .option('--folder <path>', 'The folder to create it in (default: the root)')
    .option('-y, --yes', 'Create without asking for confirmation')
    .allowExcessArguments(false)
    .description('Create a workflow from a workflow source directory')
    .action(async (options: SourceWriteOptions & { name?: string; folder?: string }) => {
      requireConsent(options, 'creates a workflow')
      const { client, profile } = connectCreate()
      const workspaceId = client.requireWorkspace()
      const submission = await readSubmission(options.dir, true)
      await runSourceWrite({
        directory: options.dir,
        options,
        creating: true,
        question: 'Create this workflow?',
        output: profile.output,
        send: async (dryRun) => {
          try {
            const response = await client.request<ApplyWorkflowSourceResponse>(
              'createWorkflowFromSource',
              {
                params: { workspaceId },
                ...(dryRun ? { query: { dryRun: true } } : {}),
                body: {
                  files: submission.files,
                  ...(options.name !== undefined ? { name: options.name } : {}),
                  ...(options.folder !== undefined ? { folderPath: options.folder } : {}),
                  provenance: { client: 'cli' },
                } satisfies CreateWorkflowFromSourceBody,
              }
            )
            return response.data
          } catch (error) {
            return printRefusal(error)
          }
        },
      })
    })
}

function summarize(data: SourceApplyData, created = false) {
  return {
    workflowId: data.workflowId,
    ...(created ? { created: data.applied } : {}),
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
      data.notes.length,
    fingerprint: data.fingerprint,
    needsRedeployment: data.needsRedeployment,
  }
}
