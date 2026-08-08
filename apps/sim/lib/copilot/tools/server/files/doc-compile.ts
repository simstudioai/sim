import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { isDocSandboxEnabled } from '@/lib/core/config/env-flags'
import { CodeLanguage } from '@/lib/execution/languages'
import {
  executeInSandbox,
  executeShellInSandbox,
  type SandboxFile,
} from '@/lib/execution/remote-sandbox'
import { runSandboxTask } from '@/lib/execution/sandbox/run-task'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { WorkspaceFileSecretProvenanceIdentity } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { getContentType } from '@/app/api/files/utils'
import type { SandboxTaskId } from '@/sandbox-tasks/registry'
import { loadCompiledDoc, storeCompiledDoc } from './doc-compiled-store'

const logger = createLogger('CopilotDocCompile')

/**
 * Thrown when the user-authored Python script itself fails (raised an exception
 * or produced no output) — i.e. an error the agent should fix by editing the
 * script. Infra failures (E2B sandbox create/timeout, S3) propagate as plain
 * Errors so callers can return 5xx instead of telling the agent its script was
 * wrong.
 */
export class DocCompileUserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocCompileUserError'
  }
}

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PDF_MIME = 'application/pdf'

// When the E2B doc sandbox is enabled, ALL four formats compile there: pptx/docx
// via Node (pptxgenjs/docx + react-icons/sharp icons), pdf/xlsx via Python
// (reportlab/openpyxl). Source MIMEs for the node engines match the isolated-vm
// JS path; the python engines have distinct markers.
export const PPTXGENJS_SOURCE_MIME = 'text/x-pptxgenjs'
export const DOCXJS_SOURCE_MIME = 'text/x-docxjs'
export const PYTHON_PDF_SOURCE_MIME = 'text/x-python-pdf'
export const PYTHON_XLSX_SOURCE_MIME = 'text/x-python-xlsx'

export type DocEngine = 'node' | 'python'

export interface E2BDocFormat {
  ext: 'pptx' | 'docx' | 'pdf' | 'xlsx'
  engine: DocEngine
  formatName: 'PPTX' | 'DOCX' | 'PDF' | 'XLSX'
  contentType: string
  sourceMime: string
}

/**
 * Resolves the E2B doc format + engine for a filename, or null for non-docs.
 * pptx/docx → node, pdf/xlsx → python. Only meaningful when the E2B doc sandbox
 * is enabled; callers gate on isDocSandboxEnabled before using this.
 */
export async function getE2BDocFormat(fileName: string): Promise<E2BDocFormat | null> {
  const l = fileName.toLowerCase()
  if (l.endsWith('.pptx'))
    return {
      ext: 'pptx',
      engine: 'node',
      formatName: 'PPTX',
      contentType: PPTX_MIME,
      sourceMime: PPTXGENJS_SOURCE_MIME,
    }
  if (l.endsWith('.docx'))
    return {
      ext: 'docx',
      engine: 'node',
      formatName: 'DOCX',
      contentType: DOCX_MIME,
      sourceMime: DOCXJS_SOURCE_MIME,
    }
  if (l.endsWith('.pdf'))
    return {
      ext: 'pdf',
      engine: 'python',
      formatName: 'PDF',
      contentType: PDF_MIME,
      sourceMime: PYTHON_PDF_SOURCE_MIME,
    }
  // xlsx availability is owned entirely by mothership's xlsx-writing flag, which
  // gates the skill and the prompt. If the model was never told xlsx exists it
  // never asks, so a second chokepoint here only created a way for the two
  // halves to disagree across an AppConfig-application boundary.
  if (l.endsWith('.xlsx'))
    return {
      ext: 'xlsx',
      engine: 'python',
      formatName: 'XLSX',
      contentType: XLSX_MIME,
      sourceMime: PYTHON_XLSX_SOURCE_MIME,
    }
  return null
}

// The skills reference workspace images by BARE file id through the injected
// helpers — `getFileBase64(id)`, `addImage(slide, id, ...)` (pptx),
// `addImage(id, ...)` (docx), `drawImage(page, id, ...)` (pdf) — never as a path.
// Capture the id from those call sites (skipping a leading slide/page argument),
// plus the legacy `/home/user/inputs/<id>` path, so referenced files are staged
// before the script runs. Without this the sandbox `getFileBase64` throws
// "file not staged" and every workspace-image embed silently fails.
const INPUT_PATH_RE = /\/home\/user\/inputs\/([A-Za-z0-9_-]+)/g
const FILE_HELPER_RE =
  /\b(?:getFileBase64|addImage|drawImage)\(\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?['"]([A-Za-z0-9_-]+)['"]/g

// The doc source is user/LLM-controlled, so bound how much it can pull into the
// sandbox: each `/home/user/inputs/<id>` reference is only ~35 bytes, so the
// source-size cap alone does not bound staging. These caps prevent an
// authenticated member from forcing thousands of (or very large) workspace files
// to be downloaded and base64-held in-process per compile request.
const MAX_STAGED_INPUTS = 20
const MAX_STAGED_FILE_BYTES = 25 * 1024 * 1024
const MAX_STAGED_TOTAL_BYTES = 50 * 1024 * 1024

interface ResolvedReferencedImage {
  fileId: string
  record: NonNullable<Awaited<ReturnType<typeof getWorkspaceFile>>>
}

interface ReferencedImageResolution {
  images: ResolvedReferencedImage[]
  referenceCount: number
  artifactIdentity?: string
}

export interface CompiledDocResult {
  buffer: Buffer
  contentType: string
  contributingFiles?: readonly WorkspaceFileSecretProvenanceIdentity[]
}

function referencedImageIdentities(
  resolution: ReferencedImageResolution
): WorkspaceFileSecretProvenanceIdentity[] {
  return resolution.images.map(({ record }) => ({
    fileId: record.id,
    key: record.key,
    context: record.storageContext ?? 'workspace',
    contentUpdatedAt: record.contentUpdatedAt ?? record.updatedAt,
  }))
}

/**
 * Collects the workspace file ids a doc source references — from the injected
 * image-helper call sites and the legacy `/home/user/inputs/<id>` path. Matching
 * is scoped to the helper calls (not bare id-like strings in slide text), and the
 * caller skips any id that does not resolve to a real file, so over-matching is
 * harmless. Retention stops at one over the remote staging limit: callers need
 * only distinguish no references, an admissible set, and an oversized set.
 */
export function collectReferencedFileIds(source: string): Set<string> {
  const ids = new Set<string>()
  for (const re of [INPUT_PATH_RE, FILE_HELPER_RE]) {
    for (const match of source.matchAll(re)) {
      if (match[1]) {
        ids.add(match[1])
        if (ids.size > MAX_STAGED_INPUTS) return ids
      }
    }
  }
  return ids
}

async function resolveReferencedImages(
  source: string,
  workspaceId: string,
  ids = collectReferencedFileIds(source)
): Promise<ReferencedImageResolution> {
  if (ids.size > MAX_STAGED_INPUTS) {
    throw new Error(
      `More than ${MAX_STAGED_INPUTS} referenced input files; maximum is ${MAX_STAGED_INPUTS}. Reference fewer files.`
    )
  }
  if (ids.size === 0) {
    return { images: [], referenceCount: 0 }
  }

  const images: ResolvedReferencedImage[] = []
  const identity: Array<Record<string, unknown>> = []
  for (const fileId of ids) {
    let record: Awaited<ReturnType<typeof getWorkspaceFile>>
    try {
      record = await getWorkspaceFile(workspaceId, fileId)
    } catch (err) {
      logger.warn('Failed to resolve referenced image for doc compile', {
        workspaceId,
        fileId,
        error: getErrorMessage(err),
      })
      identity.push({ fileId, state: 'unavailable' })
      continue
    }
    if (!record) {
      identity.push({ fileId, state: 'missing' })
      continue
    }
    identity.push({
      fileId,
      key: record.key,
      context: record.storageContext ?? 'workspace',
      contentVersion: (record.contentUpdatedAt ?? record.updatedAt).toISOString(),
      size: record.size,
    })
    images.push({ fileId, record })
  }

  return {
    images,
    referenceCount: ids.size,
    artifactIdentity: JSON.stringify({ version: 1, inputs: identity }),
  }
}

async function stageReferencedImages(
  resolution: ReferencedImageResolution,
  workspaceId: string
): Promise<SandboxFile[]> {
  if (resolution.referenceCount > MAX_STAGED_INPUTS) {
    throw new Error(
      `More than ${MAX_STAGED_INPUTS} referenced input files; maximum is ${MAX_STAGED_INPUTS}. Reference fewer files.`
    )
  }

  const files: SandboxFile[] = []
  let totalBytes = 0
  for (const { fileId, record } of resolution.images) {
    if (typeof record.size === 'number' && record.size > MAX_STAGED_FILE_BYTES) {
      logger.warn('Skipping oversized referenced image for doc compile', {
        workspaceId,
        fileId,
        size: record.size,
      })
      continue
    }
    if (totalBytes + (record.size ?? 0) > MAX_STAGED_TOTAL_BYTES) {
      throw new Error(
        `Referenced input files exceed the ${MAX_STAGED_TOTAL_BYTES} byte staging budget.`
      )
    }
    let buffer: Buffer
    try {
      buffer = await fetchWorkspaceFileBuffer(record, { maxBytes: MAX_STAGED_FILE_BYTES })
    } catch (err) {
      logger.warn('Failed to stage referenced image for doc compile', {
        workspaceId,
        fileId,
        error: getErrorMessage(err),
      })
      continue
    }
    // Enforce the per-file cap on actual bytes too: record.size can be null/stale,
    // in which case the pre-fetch check above is skipped and a single oversized
    // file would otherwise be fully base64-held in memory.
    if (buffer.length > MAX_STAGED_FILE_BYTES) {
      logger.warn('Skipping oversized referenced image for doc compile (post-fetch)', {
        workspaceId,
        fileId,
        size: buffer.length,
      })
      continue
    }
    // Budget check after the fetch (record.size may be unset/stale) — kept
    // outside the catch above so it fails the compile rather than being skipped.
    totalBytes += buffer.length
    if (totalBytes > MAX_STAGED_TOTAL_BYTES) {
      throw new Error(
        `Referenced input files exceed the ${MAX_STAGED_TOTAL_BYTES} byte staging budget.`
      )
    }
    files.push({
      path: `/home/user/inputs/${fileId}`,
      content: buffer.toString('base64'),
      encoding: 'base64',
    })
  }
  return files
}

const DOC_COMPILE_TIMEOUT_MS = 120_000

// Appended to xlsx compile scripts: LibreOffice recalculates formulas on
// load/convert and writes cached values, then we move the result back over
// output.xlsx so the binary read back has computed results (openpyxl alone omits
// them). Indented at column 0 so it concatenates cleanly after the user's script.
const XLSX_RECALC_SNIPPET = `
import subprocess as __sim_sp, shutil as __sim_sh, os as __sim_os
# Best-effort: bake cached formula values via LibreOffice. If recalc fails
# (soffice crash/timeout/unsupported), keep the openpyxl workbook as-is — it's
# still a valid file (formulas just lack cached values). Never fail the user's
# compile over an infra recalc failure.
try:
    __sim_os.makedirs("/home/user/__recalc", exist_ok=True)
    __sim_sp.run(
        ["soffice", "--headless", "--convert-to", "xlsx", "--outdir", "/home/user/__recalc", "/home/user/output.xlsx"],
        check=True, timeout=120, capture_output=True,
    )
    __sim_sh.move("/home/user/__recalc/output.xlsx", "/home/user/output.xlsx")
except Exception as __sim_recalc_err:
    print("xlsx recalc skipped:", __sim_recalc_err)
`.trim()

interface CompileArgs {
  source: string
  fileName: string
  workspaceId: string
  ownerKey?: string
  signal?: AbortSignal
}

/**
 * Compiles a Python document script to its binary in the dedicated E2B doc
 * sandbox. The script must save to /home/user/output.<ext>; we read that back.
 * Throws with a human-readable message when the script errors or writes nothing.
 * Internal — callers use compileDoc (load-or-build + store).
 */
async function compileDocViaE2BPython(
  { source, workspaceId }: CompileArgs,
  fmt: E2BDocFormat,
  referencedImages: ReferencedImageResolution
): Promise<Buffer> {
  const sandboxFiles = await stageReferencedImages(referencedImages, workspaceId)
  const outputSandboxPath = `/home/user/output.${fmt.ext}`

  // openpyxl writes formula strings but no cached values, so a web viewer (SheetJS)
  // renders formula cells blank. Recalculate in place with LibreOffice (it
  // evaluates formulas on load and writes cached values on convert) so the stored
  // artifact — and everything that serves it — shows computed results. pdf is
  // unaffected. Runs only after the user's script succeeds.
  const code = fmt.ext === 'xlsx' ? `${source}\n${XLSX_RECALC_SNIPPET}` : source

  const result = await executeInSandbox({
    code,
    language: CodeLanguage.Python,
    timeoutMs: DOC_COMPILE_TIMEOUT_MS,
    sandboxFiles,
    outputSandboxPath,
    sandboxKind: 'doc',
  })

  if (result.error) {
    // The script raised — a user-code error the agent should fix.
    throw new DocCompileUserError(result.error)
  }
  if (!result.exportedFileContent) {
    throw new DocCompileUserError(
      `${fmt.formatName} generation produced no output. The script must save to ${outputSandboxPath}.`
    )
  }
  return Buffer.from(result.exportedFileContent, 'base64')
}

// ── Node engine (pptxgenjs / docx) ──────────────────────────────────────────
// Preambles replicate the isolated-vm bootstraps as node globals: the injected
// `pptx`/`docx` instances, geometry constants, and fileId-based image helpers
// (reading staged /home/user/inputs/<id> files). pptx also gets `iconImage`
// (react-icons → sharp → PNG), which only works here because the E2B sandbox is
// a full Linux VM. The agent's edit_content source runs inside an async IIFE so
// top-level await (addImage/iconImage) works; the finalizer writes the binary.
const PPTX_NODE_PREAMBLE = `
const PptxGenJS = require('pptxgenjs');
const fs = require('fs');
globalThis.pptx = new PptxGenJS();
globalThis.pptx.layout = 'LAYOUT_16x9';
globalThis.SLIDE_W = 10; globalThis.SLIDE_H = 5.625;
globalThis.MARGIN = 0.5; globalThis.CONTENT_W = 9; globalThis.CONTENT_H = 3.8;
function __mime(b){ if(b.length>=2&&b[0]===0x89&&b[1]===0x50)return 'image/png'; if(b.length>=2&&b[0]===0xff&&b[1]===0xd8)return 'image/jpeg'; if(b.length>=3&&b[0]===0x47&&b[1]===0x49&&b[2]===0x46)return 'image/gif'; if(b.length>=12&&b.slice(0,4).toString('latin1')==='RIFF'&&b.slice(8,12).toString('latin1')==='WEBP')return 'image/webp'; return 'image/png'; }
globalThis.getFileBase64 = async function(fileId){ const p='/home/user/inputs/'+fileId; if(!fs.existsSync(p)) throw new Error('getFileBase64: file not staged: '+fileId); const b=fs.readFileSync(p); return __mime(b)+';base64,'+b.toString('base64'); };
globalThis.addImage = async function(slide, fileId, opts){ if(!opts||opts.x==null||opts.y==null||opts.w==null||opts.h==null) throw new Error('addImage: opts must include x, y, w, h'); const data=await globalThis.getFileBase64(fileId); slide.addImage(Object.assign({}, opts, { data })); };
globalThis.iconImage = async function(IconComponent, color, size){ const React=require('react'); const RDS=require('react-dom/server'); const sharp=require('sharp'); const svg=RDS.renderToStaticMarkup(React.createElement(IconComponent,{color:color||'#000000',size:String(size||256)})); const png=await sharp(Buffer.from(svg)).png().toBuffer(); return 'image/png;base64,'+png.toString('base64'); };
`.trim()

const DOCX_NODE_PREAMBLE = `
const docx = require('docx');
const fs = require('fs');
globalThis.docx = docx;
globalThis.__docxSections = [];
globalThis.__docxDocOptions = null;
globalThis.addSection = function(s){ globalThis.__docxSections.push(s); };
globalThis.PAGE_W = 12240; globalThis.PAGE_H = 15840; globalThis.MARGIN = 1440; globalThis.CONTENT_W = 9360;
globalThis.getFileBase64 = async function(fileId){ const p='/home/user/inputs/'+fileId; if(!fs.existsSync(p)) throw new Error('getFileBase64: file not staged: '+fileId); const b=fs.readFileSync(p); const m=(b[0]===0x89?'image/png':b[0]===0xff?'image/jpeg':b[0]===0x47?'image/gif':'image/png'); return 'data:'+m+';base64,'+b.toString('base64'); };
globalThis.addImage = async function(fileId, opts){ if(!opts||opts.width==null||opts.height==null) throw new Error('addImage: opts must include width and height'); const p='/home/user/inputs/'+fileId; if(!fs.existsSync(p)) throw new Error('addImage: file not staged: '+fileId); const b=fs.readFileSync(p); const ext=(b[0]===0x89?'png':b[0]===0xff?'jpg':b[0]===0x47?'gif':'png'); const { width, height, type:_t, data:_d, transformation:ut, ...rest } = opts; return new docx.ImageRun(Object.assign(rest, { data: b, type: ext, transformation: Object.assign({ width, height }, ut||{}) })); };
`.trim()

const PPTX_NODE_FINALIZE = `await globalThis.pptx.writeFile({ fileName: '/home/user/output.pptx' });`
const DOCX_NODE_FINALIZE = `
let doc = globalThis.doc;
if (!doc && globalThis.__docxSections.length > 0) doc = new docx.Document(Object.assign({}, globalThis.__docxDocOptions || {}, { sections: globalThis.__docxSections }));
if (!doc) throw new Error('No document created. Use addSection({ children: [...] }) for chunked writes, or set globalThis.doc.');
const __buf = await docx.Packer.toBuffer(doc);
fs.writeFileSync('/home/user/output.docx', __buf);
`.trim()

/**
 * Compiles a pptx/docx document by running the agent's pptxgenjs/docx source in
 * the E2B doc sandbox via Node. Mirrors compileDocViaE2BPython for the JS
 * engines. Throws DocCompileUserError on a script error.
 */
async function compileDocViaE2BNode(
  { source, fileName, workspaceId }: CompileArgs,
  ext: 'pptx' | 'docx',
  referencedImages: ReferencedImageResolution
): Promise<Buffer> {
  const sandboxFiles = await stageReferencedImages(referencedImages, workspaceId)
  const outputSandboxPath = `/home/user/output.${ext}`
  const preamble = ext === 'pptx' ? PPTX_NODE_PREAMBLE : DOCX_NODE_PREAMBLE
  const finalize = ext === 'pptx' ? PPTX_NODE_FINALIZE : DOCX_NODE_FINALIZE

  const script = `${preamble}
;(async () => {
${source}
${finalize}
})().then(() => console.log('__DOC_OK__')).catch((e) => { console.error('__DOC_ERR__' + (e && e.message ? e.message : String(e))); process.exit(1); });
`

  const result = await executeShellInSandbox({
    code: 'NODE_PATH=$(npm root -g) node /home/user/script.js',
    envs: {},
    timeoutMs: DOC_COMPILE_TIMEOUT_MS,
    sandboxKind: 'doc',
    sandboxFiles: [
      ...sandboxFiles,
      {
        path: '/home/user/script.js',
        content: Buffer.from(script, 'utf-8').toString('base64'),
        encoding: 'base64',
      },
    ],
    outputSandboxPath,
  })

  // Success requires the script to reach the finalizer (__DOC_OK__) AND produce
  // the output file — a script that writes then throws must not persist a
  // partial/corrupt artifact (mirrors the Python path).
  const out = `${result.stdout || ''}\n${result.error || ''}`
  const errMatch = out.match(/__DOC_ERR__([\s\S]*)/)
  if (out.includes('__DOC_OK__') && result.exportedFileContent) {
    return Buffer.from(result.exportedFileContent, 'base64')
  }
  if (errMatch) {
    // The script ran and threw — a user-code error the agent should fix.
    throw new DocCompileUserError(
      `${ext.toUpperCase()} generation failed: ${errMatch[1]?.trim() || 'unknown error'}`
    )
  }
  // No __DOC_OK__ and no __DOC_ERR__ → node never completed (sandbox died, command
  // failure, or the output couldn't be read). That's a retriable system error, not
  // the agent's code — surface it as a plain Error so callers don't tell the agent
  // to "fix its code".
  throw new Error(
    `${ext.toUpperCase()} compile did not complete in the sandbox: ${result.error || 'no output produced'}`
  )
}

async function buildCompiledDoc(
  args: CompileArgs,
  fmt: E2BDocFormat,
  referencedImages: ReferencedImageResolution
): Promise<CompiledDocResult> {
  const { source, fileName, workspaceId } = args
  const buffer =
    fmt.engine === 'node'
      ? await compileDocViaE2BNode(
          { source, fileName, workspaceId },
          fmt.ext as 'pptx' | 'docx',
          referencedImages
        )
      : await compileDocViaE2BPython({ source, fileName, workspaceId }, fmt, referencedImages)
  await storeCompiledDoc(
    workspaceId,
    source,
    fmt.ext,
    fmt.contentType,
    buffer,
    referencedImages.artifactIdentity
  )
  const contributingFiles = referencedImageIdentities(referencedImages)
  return {
    buffer,
    contentType: fmt.contentType,
    ...(contributingFiles.length > 0 ? { contributingFiles } : {}),
  }
}

interface CompilableFormat {
  magic: Buffer
  taskId: SandboxTaskId
  contentType: string
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])

const COMPILABLE_FORMATS: Record<string, CompilableFormat> = {
  '.pptx': { magic: ZIP_MAGIC, taskId: 'pptx-generate', contentType: PPTX_MIME },
  '.docx': { magic: ZIP_MAGIC, taskId: 'docx-generate', contentType: DOCX_MIME },
  '.pdf': { magic: PDF_MAGIC, taskId: 'pdf-generate', contentType: PDF_MIME },
}

async function compileDocInLegacySandbox(
  args: CompileArgs,
  fmt: E2BDocFormat
): Promise<CompiledDocResult> {
  const format = COMPILABLE_FORMATS[`.${fmt.ext}`]
  if (!format) {
    throw new DocCompileUserError('Document is still being generated')
  }

  const cacheKey = sha256Hex(`.${fmt.ext}${args.source}${args.workspaceId}`)
  const cached = compiledDocCache.get(cacheKey)
  if (cached) {
    return {
      buffer: cached.buffer,
      contentType: fmt.contentType,
      ...(cached.contributingFiles && cached.contributingFiles.length > 0
        ? { contributingFiles: cached.contributingFiles }
        : {}),
    }
  }

  const contributingFiles = new Map<string, WorkspaceFileSecretProvenanceIdentity>()
  const buffer = await runSandboxTask(
    format.taskId,
    { code: args.source, workspaceId: args.workspaceId },
    {
      ownerKey: args.ownerKey,
      signal: args.signal,
      onWorkspaceFileAccess: (identity) => {
        contributingFiles.set(`${identity.context}:${identity.fileId}:${identity.key}`, identity)
      },
    }
  )
  compiledCacheSet(cacheKey, buffer, [...contributingFiles.values()])
  return {
    buffer,
    contentType: fmt.contentType,
    ...(contributingFiles.size > 0 ? { contributingFiles: [...contributingFiles.values()] } : {}),
  }
}

/**
 * Returns the compiled binary for a document. The remote backend reuses and publishes a
 * dependency-bound artifact after statically staging its inputs. The isolated-VM backend preserves
 * its live-broker semantics and keeps only a small process-local cache; it cannot publish a durable
 * artifact until broker calls can report the exact file versions they accessed.
 */
export async function compileDoc(args: CompileArgs): Promise<CompiledDocResult> {
  const { source, fileName, workspaceId } = args
  const fmt = await getE2BDocFormat(fileName)
  if (!fmt) throw new Error(`Unsupported document format: ${fileName}`)
  if (!isDocSandboxEnabled) return compileDocInLegacySandbox(args, fmt)

  const referencedFileIds = collectReferencedFileIds(source)
  const referencedImages = await resolveReferencedImages(source, workspaceId, referencedFileIds)

  const existing = await loadCompiledDoc(
    workspaceId,
    source,
    fmt.ext,
    referencedImages.artifactIdentity
  )
  if (existing) {
    const contributingFiles = referencedImageIdentities(referencedImages)
    return {
      buffer: existing,
      contentType: fmt.contentType,
      ...(contributingFiles.length > 0 ? { contributingFiles } : {}),
    }
  }
  return buildCompiledDoc(args, fmt, referencedImages)
}

/**
 * Loads a dependency-bound compiled artifact. Public shares may also read a pre-cutover
 * source-keyed artifact. That fallback preserves already-public documents even when their
 * original inputs no longer resolve; it only reads an existing binary and never executes source.
 */
export async function loadCompiledDocByExt(
  workspaceId: string,
  source: string,
  ext: string,
  options: { allowLegacyReferencedArtifact?: boolean } = {}
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const fmt = await getE2BDocFormat(`x.${ext}`)
  if (!fmt) return null
  const referencedFileIds = collectReferencedFileIds(source)
  if (referencedFileIds.size > MAX_STAGED_INPUTS) {
    if (!options.allowLegacyReferencedArtifact) return null
    const legacyBuffer = await loadCompiledDoc(workspaceId, source, fmt.ext)
    return legacyBuffer ? { buffer: legacyBuffer, contentType: fmt.contentType } : null
  }
  const referencedImages = await resolveReferencedImages(source, workspaceId, referencedFileIds)
  const buffer = await loadCompiledDoc(
    workspaceId,
    source,
    fmt.ext,
    referencedImages.artifactIdentity
  )
  if (buffer) return { buffer, contentType: fmt.contentType }
  if (referencedImages.artifactIdentity && options.allowLegacyReferencedArtifact) {
    const legacyBuffer = await loadCompiledDoc(workspaceId, source, fmt.ext)
    if (legacyBuffer) return { buffer: legacyBuffer, contentType: fmt.contentType }
  }
  return null
}

function bufferStartsWith(buffer: Buffer, magic: Buffer): boolean {
  return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic)
}

/**
 * How a read-only consumer (e.g. the public share route) should serve a stored doc:
 * - `passthrough` — serve the raw stored bytes as-is (a non-doc file, or an uploaded
 *   binary that already carries its format magic).
 * - `artifact` — serve a dependency-bound compiled binary, or an eligible pre-cutover public artifact.
 * - `unavailable` — a generated doc stored as source whose compiled artifact does
 *   not exist yet; the raw bytes are source, so serving them under the file's binary
 *   content type would be corrupt. The caller should signal "not ready" instead.
 */
export type ServableDoc =
  | { kind: 'passthrough' }
  | { kind: 'artifact'; buffer: Buffer; contentType: string }
  | { kind: 'unavailable' }

export async function resolveServableDoc(
  workspaceId: string,
  storedBytes: Buffer,
  fileName: string
): Promise<ServableDoc> {
  const fmt = await getE2BDocFormat(fileName)
  if (!fmt) return { kind: 'passthrough' }
  const magic = fmt.ext === 'pdf' ? PDF_MAGIC : ZIP_MAGIC
  if (bufferStartsWith(storedBytes, magic)) return { kind: 'passthrough' }
  try {
    const artifact = await loadCompiledDocByExt(
      workspaceId,
      storedBytes.toString('utf-8'),
      fmt.ext,
      { allowLegacyReferencedArtifact: true }
    )
    return artifact ? { kind: 'artifact', ...artifact } : { kind: 'unavailable' }
  } catch (error) {
    if (error instanceof DocCompileUserError) return { kind: 'unavailable' }
    throw error
  }
}

const MAX_COMPILED_DOC_CACHE = 10
interface CompiledDocCacheEntry {
  buffer: Buffer
  contributingFiles?: readonly WorkspaceFileSecretProvenanceIdentity[]
}

const compiledDocCache = new Map<string, CompiledDocCacheEntry>()

function compiledCacheSet(
  key: string,
  buffer: Buffer,
  contributingFiles: readonly WorkspaceFileSecretProvenanceIdentity[] = []
): void {
  if (compiledDocCache.size >= MAX_COMPILED_DOC_CACHE) {
    compiledDocCache.delete(compiledDocCache.keys().next().value as string)
  }
  compiledDocCache.set(key, {
    buffer,
    ...(contributingFiles.length > 0 ? { contributingFiles } : {}),
  })
}

/**
 * Resolves the bytes a consumer should actually serve/attach for a stored file —
 * the single source of truth shared by the file-serve route and every tool that
 * downloads a workspace file (email attachments, uploads, provider file inputs).
 *
 * Generated docs (pdf/docx/pptx/xlsx) store their GENERATION SOURCE as the primary
 * file; the rendered binary lives in a separate content-addressed artifact store.
 * A naive raw-byte read therefore hands out source text under a `.pdf` name — the
 * corruption every non-serve consumer used to ship. The file-serve route and the
 * attachment download helper share this one function so they resolve identically.
 * (The public read-only share route uses the non-compiling {@link resolveServableDoc}
 * variant, which returns `unavailable` instead of throwing.) The swap:
 *
 * - Bytes already carry the format magic (`%PDF`/ZIP) → real uploaded/binary file,
 *   serve as-is.
 * - Generated-doc source → load the content-addressed compiled artifact.
 * - Artifact missing in the E2B regime → the doc is still being generated; throw
 *   {@link DocCompileUserError} so callers signal "not ready / retry" instead of
 *   shipping source.
 * - E2B disabled → compile the committed JS source via isolated-vm (cached).
 * - Non-doc files → pass through with the extension-derived content type.
 *
 * It never falls back to attaching the raw source bytes for a generated doc.
 */
export async function resolveServableDocBytes(args: {
  rawBuffer: Buffer
  fileName: string
  workspaceId: string | undefined
  ownerKey?: string
  signal?: AbortSignal
}): Promise<CompiledDocResult> {
  const { rawBuffer, fileName, workspaceId, ownerKey, signal } = args
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  const extNoDot = ext.replace(/^\./, '')
  const format = COMPILABLE_FORMATS[ext]

  // xlsx isn't in COMPILABLE_FORMATS (no isolated-vm path), so match its ZIP magic
  // explicitly alongside the table-driven formats.
  const magic = format?.magic ?? (extNoDot === 'xlsx' ? ZIP_MAGIC : undefined)
  if (magic && bufferStartsWith(rawBuffer, magic)) {
    return { buffer: rawBuffer, contentType: getContentType(fileName) }
  }

  if (!format && extNoDot !== 'xlsx') {
    return { buffer: rawBuffer, contentType: getContentType(fileName) }
  }

  const source = rawBuffer.toString('utf-8')

  if (workspaceId) {
    if (!isDocSandboxEnabled || collectReferencedFileIds(source).size > 0) {
      return compileDoc({ source, fileName, workspaceId, ownerKey, signal })
    }
    const stored = await loadCompiledDocByExt(workspaceId, source, extNoDot)
    if (stored) return stored
    throw new DocCompileUserError('Document is still being generated')
  }

  // Reaches here only for xlsx, which has no isolated-vm fallback. Returning these
  // bytes would expose generation source as a spreadsheet.
  if (!format) throw new DocCompileUserError('Document is still being generated')

  const cacheKey = sha256Hex(`${ext}${source}${workspaceId ?? ''}`)
  const cached = compiledDocCache.get(cacheKey)
  if (cached) {
    return {
      buffer: cached.buffer,
      contentType: format.contentType,
      ...(cached.contributingFiles && cached.contributingFiles.length > 0
        ? { contributingFiles: cached.contributingFiles }
        : {}),
    }
  }

  const compiled = await runSandboxTask(
    format.taskId,
    { code: source, workspaceId: workspaceId || '' },
    { ownerKey, signal }
  )
  compiledCacheSet(cacheKey, compiled)
  return { buffer: compiled, contentType: format.contentType }
}
