/**
 * GitHub Actions output: inside a GitHub Actions job (`GITHUB_ACTIONS=true`) a finding becomes an
 * `::error file=…,line=…::` workflow command, which the runner shows inline on the pull request,
 * and a source write appends its plan to the job's step summary (`$GITHUB_STEP_SUMMARY`).
 *
 * The commands go to stderr: the runner reads workflow commands from both streams, and stdout
 * stays the one result document a script parses.
 */
import { appendFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { getErrorMessage } from '@sim/utils/errors'
import { embedStore } from '../embed-context'
import { isEnabled } from '../environment'
import { printError } from './io'

/** Whether this process runs as a GitHub Actions step (never inside an embedded host). */
function inGithubActions(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnabled(env.GITHUB_ACTIONS) && !embedStore.getStore()
}

/** A workflow command's message, escaped as the runner unescapes it. */
function escapeData(text: string): string {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}

/** A workflow command's property value, which also may not hold `:` or `,`. */
function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C')
}

/** Where an annotation points: a file relative to the repository, and a line and column in it. */
export interface AnnotationSite {
  file?: string
  line?: number
  column?: number
  title?: string
}

/** One `::error`/`::warning`/`::notice` workflow command line. */
export function annotationLine(
  level: 'error' | 'warning' | 'notice',
  message: string,
  site: AnnotationSite = {}
): string {
  const properties = [
    site.file !== undefined ? `file=${escapeProperty(site.file)}` : null,
    site.line !== undefined ? `line=${site.line}` : null,
    site.column !== undefined ? `col=${site.column}` : null,
    site.title !== undefined ? `title=${escapeProperty(site.title)}` : null,
  ].filter((property) => property !== null)
  return `::${level}${properties.length > 0 ? ` ${properties.join(',')}` : ''}::${escapeData(message)}`
}

/**
 * `file` (relative to the source directory `dir`) as the runner resolves an annotation's path:
 * relative to the repository root (`GITHUB_WORKSPACE`), whatever the step's working directory. A
 * file outside the repository is given by its absolute path.
 */
export function annotationPath(
  dir: string,
  file: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const absolute = resolve(dir, file)
  const path = relative(env.GITHUB_WORKSPACE || process.cwd(), absolute)
  return path.startsWith('..') || isAbsolute(path) ? absolute : path
}

/** Prints `lines` as workflow commands, when this is a GitHub Actions step. */
export function printAnnotations(lines: readonly string[]): void {
  if (!inGithubActions()) return
  for (const line of lines) printError(line)
}

/**
 * Appends `markdown()` (built only then) to the job's step summary, when this is a GitHub Actions
 * step that has one. A summary that cannot be written is reported and skipped: the command's own
 * result stands.
 */
export function appendStepSummary(
  markdown: () => string,
  env: NodeJS.ProcessEnv = process.env
): void {
  const path = env.GITHUB_STEP_SUMMARY
  if (!inGithubActions(env) || !path) return
  try {
    appendFileSync(path, `${markdown().trimEnd()}\n\n`)
  } catch (error) {
    printError(`The step summary could not be written: ${getErrorMessage(error)}`)
  }
}
