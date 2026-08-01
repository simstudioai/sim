import { createLogger } from '@sim/logger'
import { CodeLanguage } from '@/lib/execution/languages'
import { executeInSandbox } from '@/lib/execution/remote-sandbox'
import { compileDoc, DocCompileUserError } from './doc-compile'

const logger = createLogger('CopilotDocRecalc')

const RECALC_TIMEOUT_MS = 150_000
const MAX_REPORTED_ERRORS = 50

export interface XlsxCellError {
  sheet: string
  cell: string
  error: string
}

export interface XlsxRecalcResult {
  ok: boolean
  errors: XlsxCellError[]
}

/**
 * Scans an .xlsx workbook for spilled error values (#REF!/#DIV/0!/etc.) — the
 * spreadsheet equivalent of the visual QA loop.
 *
 * Precondition: the binary must already be recalculated (cached values present).
 * compileDoc bakes a LibreOffice recalc into every xlsx artifact, so the input
 * here always has cached values — meaning we can read them with openpyxl
 * (data_only) directly and skip a second LibreOffice cold-start. Throws on
 * sandbox/infra failure.
 */
export async function recalcXlsx(args: {
  binary: Buffer
  workspaceId: string
}): Promise<XlsxRecalcResult> {
  const script = `
import json, openpyxl

ERR = {"#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NULL!", "#NUM!"}

# Input is already recalculated by compileDoc, so cached values are present.
wb = openpyxl.load_workbook("/home/user/input.xlsx", data_only=True)
errors = []
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.strip() in ERR:
                errors.append({"sheet": ws.title, "cell": c.coordinate, "error": c.value.strip()})

print("__SIM_RESULT__=" + json.dumps({"ok": len(errors) == 0, "errors": errors[:${MAX_REPORTED_ERRORS}]}))
`.trim()

  const result = await executeInSandbox({
    code: script,
    language: CodeLanguage.Python,
    timeoutMs: RECALC_TIMEOUT_MS,
    sandboxKind: 'doc',
    sandboxFiles: [
      {
        path: '/home/user/input.xlsx',
        content: args.binary.toString('base64'),
        encoding: 'base64',
      },
    ],
  })

  if (result.error) {
    throw new Error(`Spreadsheet recalc failed: ${result.error}`)
  }
  const payload = result.result as XlsxRecalcResult | null
  if (!payload || typeof payload.ok !== 'boolean') {
    logger.warn('Recalc returned no structured result', { workspaceId: args.workspaceId })
    return { ok: true, errors: [] }
  }
  return { ok: payload.ok, errors: Array.isArray(payload.errors) ? payload.errors : [] }
}

/** Single-line summary of the first few formula errors, for the compiled-check result. */
export function formatXlsxErrors(errors: XlsxCellError[]): string {
  return `${errors.length} formula error(s): ${errors
    .slice(0, 5)
    .map((e) => `${e.sheet}!${e.cell}=${e.error}`)
    .join(', ')}`
}

export interface CompiledCheckResult {
  ok: boolean
  error?: string
  errors?: XlsxCellError[]
}

/**
 * Compiles a generated doc (and, for xlsx, recalc-scans its formulas) to verify
 * it builds — the shared body behind the /compiled-check route and the VFS
 * compiled-check read. Returns { ok: false } only for a DocCompileUserError (the
 * agent's script is wrong); infra failures (E2B/S3) rethrow so callers surface a
 * 5xx instead of telling the agent to fix its script.
 */
export async function runE2BCompiledCheck(args: {
  source: string
  fileName: string
  workspaceId: string
  ext: string
}): Promise<CompiledCheckResult> {
  try {
    const compiled = await compileDoc({
      source: args.source,
      fileName: args.fileName,
      workspaceId: args.workspaceId,
    })
    if (args.ext === 'xlsx') {
      const recalc = await recalcXlsx({ binary: compiled.buffer, workspaceId: args.workspaceId })
      return recalc.ok
        ? { ok: true }
        : { ok: false, error: formatXlsxErrors(recalc.errors), errors: recalc.errors }
    }
    return { ok: true }
  } catch (err) {
    if (err instanceof DocCompileUserError) return { ok: false, error: err.message }
    throw err
  }
}
