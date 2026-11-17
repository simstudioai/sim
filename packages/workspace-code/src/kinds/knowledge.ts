/**
 * Knowledge bases: `knowledge/<key>/knowledge.ts` declares one knowledge base's name, description,
 * folder, chunking and embedding model; every file in `knowledge/<key>/docs/` is one document,
 * synced by its SHA-256. Documents are flat (no subfolders) and named by their file name.
 * Connector-synced documents are never part of source.
 *
 * ```ts
 * export default defineKnowledgeBase({
 *   name: 'Policies',
 *   chunking: { maxSize: 1024, minSize: 100, overlap: 200 },
 * })
 * ```
 */
import { compareStrings } from '@sim/utils/string'
import type { Json } from '@sim/workflow-code'
import {
  checkKnownFields,
  type FieldReport,
  fieldPointer,
  fieldReporter,
  readBooleanField,
  readObject,
  readStringField,
} from '../declaration/fields'
import { printDeclaration } from '../declaration/print'
import { readDeclaration } from '../declaration/read'
import { diagnostic, type WorkspaceDiagnostic, wholeFile } from '../diagnostics'
import { type BlobEntry, KIND_DIRS, type KindCodec } from '../kind'
import { WORKSPACE_SOURCE_LIMITS } from '../limits'
import { filePathProblem, foldedFileKey } from './files'
import { groupByFolder } from './group'

/** Chunking strategies (`ChunkingStrategy` in apps/sim/lib/chunkers/types). */
const CHUNKING_STRATEGIES = ['auto', 'text', 'regex', 'recursive', 'sentence', 'token'] as const
const RECURSIVE_RECIPES = ['plain', 'markdown', 'code'] as const

/** How a knowledge base splits its documents into chunks. */
export interface KnowledgeChunkingDecl {
  /** Largest chunk, in tokens. */
  maxSize?: number
  /** Smallest chunk, in characters. */
  minSize?: number
  /** Tokens shared by neighbouring chunks. */
  overlap?: number
  strategy?: (typeof CHUNKING_STRATEGIES)[number]
  strategyOptions?: {
    pattern?: string
    separators?: string[]
    recipe?: (typeof RECURSIVE_RECIPES)[number]
    strictBoundaries?: boolean
  }
}

/** One document file, by content hash. */
export interface KnowledgeDocDecl {
  sha256: string
  size: number
}

/** A knowledge base as `knowledge/<key>/` declares it. */
export interface KnowledgeBaseDecl {
  name: string
  description?: string
  /** The knowledge base folder path (`/support`); the workspace root when absent. */
  folder?: string
  chunking?: KnowledgeChunkingDecl
  /** Fixed when the knowledge base is created; a different value is refused afterwards. */
  embeddingModel?: string
  /** File name → content. */
  docs: Record<string, KnowledgeDocDecl>
}

/**
 * The chunking a knowledge base gets when none is declared. Mirrors `DEFAULT_CHUNKING_CONFIG`
 * (apps/sim/lib/knowledge/constants), so an undeclared and a spelled-out default agree.
 */
const DEFAULT_CHUNKING = { maxSize: 1024, minSize: 100, overlap: 200 } as const

/** Mirrors `KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH` (apps/sim/lib/knowledge/constants). */
const MAX_DESCRIPTION_LENGTH = 10_000
const SHA256 = /^[0-9a-f]{64}$/

const CALLEE = 'defineKnowledgeBase'
const DECLARATION_FILE = 'knowledge.ts'
const DOCS_FOLDER = 'docs'
const KNOWLEDGE_FIELDS = ['name', 'description', 'folder', 'chunking', 'embeddingModel']
const CHUNKING_FIELDS = ['maxSize', 'minSize', 'overlap', 'strategy', 'strategyOptions']
const STRATEGY_OPTION_FIELDS = ['pattern', 'separators', 'recipe', 'strictBoundaries']

/** `knowledge/<key>/knowledge.ts`. */
function knowledgeDeclarationPath(key: string): string {
  return `${KIND_DIRS['knowledge-base']}/${key}/${DECLARATION_FILE}`
}

/** `knowledge/<key>/docs/<name>`. */
export function knowledgeDocPath(key: string, name: string): string {
  return `${KIND_DIRS['knowledge-base']}/${key}/${DOCS_FOLDER}/${name}`
}

/**
 * Whether a document file name can be a file of the directory: one path segment that any disk
 * can hold, by the rules workspace files follow ({@link filePathProblem}).
 */
export function isKnowledgeDocName(name: string): boolean {
  return !name.includes('/') && filePathProblem(name) === null
}

function oneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value)
}

function readSizeField(
  value: Record<string, Json>,
  field: string,
  pointer: string,
  report: FieldReport
): number | undefined {
  const raw = value[field]
  if (raw === undefined) return undefined
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    report('E_DECL_SHAPE', fieldPointer(pointer, field), `"${field}" must be a whole number.`)
    return undefined
  }
  return raw
}

function readEnumField<T extends string>(
  value: Record<string, Json>,
  field: string,
  allowed: readonly T[],
  pointer: string,
  report: FieldReport
): T | undefined {
  const raw = readStringField(value, field, pointer, report)
  if (raw === undefined) return undefined
  if (oneOf(allowed, raw)) return raw
  report(
    'E_DECL_SHAPE',
    fieldPointer(pointer, field),
    `"${field}" is one of ${allowed.join(', ')}.`
  )
  return undefined
}

function readStrategyOptions(
  raw: Json,
  pointer: string,
  report: FieldReport
): KnowledgeChunkingDecl['strategyOptions'] {
  const value = readObject(raw, pointer, report, 'strategyOptions')
  if (!value) return undefined
  checkKnownFields(value, STRATEGY_OPTION_FIELDS, pointer, report)
  const options: NonNullable<KnowledgeChunkingDecl['strategyOptions']> = {}
  const pattern = readStringField(value, 'pattern', pointer, report)
  if (pattern !== undefined) options.pattern = pattern
  const separators = value.separators
  if (separators !== undefined) {
    if (Array.isArray(separators) && separators.every((item) => typeof item === 'string')) {
      options.separators = separators as string[]
    } else {
      report(
        'E_DECL_SHAPE',
        fieldPointer(pointer, 'separators'),
        '"separators" must be a list of strings.'
      )
    }
  }
  const recipe = readEnumField(value, 'recipe', RECURSIVE_RECIPES, pointer, report)
  if (recipe !== undefined) options.recipe = recipe
  const strict = readBooleanField(value, 'strictBoundaries', pointer, report)
  if (strict !== undefined) options.strictBoundaries = strict
  return options
}

function readChunking(raw: Json, report: FieldReport): KnowledgeChunkingDecl | undefined {
  const pointer = '/chunking'
  const value = readObject(raw, pointer, report, 'chunking')
  if (!value) return undefined
  checkKnownFields(value, CHUNKING_FIELDS, pointer, report)
  const chunking: KnowledgeChunkingDecl = {}
  for (const field of ['maxSize', 'minSize', 'overlap'] as const) {
    const size = readSizeField(value, field, pointer, report)
    if (size !== undefined) chunking[field] = size
  }
  const strategy = readEnumField(value, 'strategy', CHUNKING_STRATEGIES, pointer, report)
  if (strategy !== undefined) chunking.strategy = strategy
  if (value.strategyOptions !== undefined) {
    const options = readStrategyOptions(
      value.strategyOptions,
      fieldPointer(pointer, 'strategyOptions'),
      report
    )
    if (options) chunking.strategyOptions = options
  }
  return chunking
}

function fileFinding(
  code: 'E_KB_DOC_NAME' | 'E_DECL_SHAPE' | 'E_LIMIT_EXCEEDED' | 'E_DECL_UNKNOWN_FILE',
  key: string,
  path: string,
  message: string,
  hint?: string
): WorkspaceDiagnostic {
  return diagnostic(code, message, {
    kind: 'knowledge-base',
    key,
    ...(hint ? { hint } : {}),
    span: wholeFile(path),
  })
}

function readDocs(
  key: string,
  blobs: readonly BlobEntry[],
  diagnostics: WorkspaceDiagnostic[]
): Record<string, KnowledgeDocDecl> {
  const prefix = knowledgeDocPath(key, '')
  const docs: Array<[string, KnowledgeDocDecl]> = []
  const folded = new Map<string, string>()
  for (const blob of [...blobs].sort((a, b) => compareStrings(a.path, b.path))) {
    const name = blob.path.slice(prefix.length)
    const earlier = folded.get(foldedFileKey(name))
    if (!blob.path.startsWith(prefix) || !isKnowledgeDocName(name)) {
      diagnostics.push(
        fileFinding('E_KB_DOC_NAME', key, blob.path, `${blob.path} is not a document file name.`)
      )
    } else if (earlier !== undefined) {
      diagnostics.push(
        fileFinding(
          'E_KB_DOC_NAME',
          key,
          blob.path,
          `${blob.path} and ${knowledgeDocPath(key, earlier)} differ only in letter case.`,
          'Keep one of them: a case-insensitive disk holds them as one.'
        )
      )
    } else if (!SHA256.test(blob.sha256) || !Number.isSafeInteger(blob.size) || blob.size < 0) {
      diagnostics.push(
        fileFinding('E_DECL_SHAPE', key, blob.path, `${blob.path} has no valid hash and size.`)
      )
    } else if (blob.size > WORKSPACE_SOURCE_LIMITS.maxBlobBytes) {
      diagnostics.push(
        fileFinding(
          'E_LIMIT_EXCEEDED',
          key,
          blob.path,
          `${blob.path} is ${blob.size} bytes, over the ${WORKSPACE_SOURCE_LIMITS.maxBlobBytes}-byte document limit.`
        )
      )
    } else {
      folded.set(foldedFileKey(name), name)
      docs.push([name, { sha256: blob.sha256, size: blob.size }])
    }
  }
  /** `fromEntries` defines own properties, so a document named `__proto__` stays a document. */
  return Object.fromEntries(docs)
}

function parseKnowledgeBase(
  key: string,
  text: Readonly<Record<string, string>>,
  blobs: readonly BlobEntry[]
): { decl?: KnowledgeBaseDecl; diagnostics: WorkspaceDiagnostic[] } {
  const file = knowledgeDeclarationPath(key)
  const resource = { kind: 'knowledge-base', key }
  const source = text[file]
  if (source === undefined) {
    return {
      diagnostics: [
        diagnostic('E_DECL_SHAPE', `${file} is missing.`, {
          ...resource,
          hint: `A knowledge/${key}/ folder declares its knowledge base in ${DECLARATION_FILE}.`,
        }),
      ],
    }
  }
  const read = readDeclaration(file, source, { callee: CALLEE })
  const diagnostics: WorkspaceDiagnostic[] = read.diagnostics.map((finding) => ({
    ...finding,
    ...resource,
  }))
  const docs = readDocs(key, blobs, diagnostics)
  if (read.value === undefined) return { diagnostics }
  const report = fieldReporter(source, read.spans, diagnostics, resource)
  const value = readObject(read.value, '', report, `${CALLEE}()`)
  if (!value) return { diagnostics }
  checkKnownFields(value, KNOWLEDGE_FIELDS, '', report)
  const name = readStringField(value, 'name', '', report, { required: true })
  const description = readStringField(value, 'description', '', report, {
    maxLength: MAX_DESCRIPTION_LENGTH,
  })
  const folder = readStringField(value, 'folder', '', report)
  if (folder !== undefined && !folder.startsWith('/')) {
    report('E_DECL_SHAPE', '/folder', 'folder is a path from the root, such as `/support`.')
  }
  const chunking = value.chunking === undefined ? undefined : readChunking(value.chunking, report)
  const embeddingModel = readStringField(value, 'embeddingModel', '', report)
  if (diagnostics.some((finding) => finding.severity === 'error') || name === undefined) {
    return { diagnostics }
  }
  return {
    decl: {
      name,
      ...(description !== undefined ? { description } : {}),
      ...(folder !== undefined ? { folder } : {}),
      ...(chunking !== undefined ? { chunking } : {}),
      ...(embeddingModel !== undefined ? { embeddingModel } : {}),
      docs,
    },
    diagnostics,
  }
}

/** Groups by folder, refusing any path but the declaration and flat `docs/` files. */
function groupKnowledge(paths: readonly string[]) {
  const dir = KIND_DIRS['knowledge-base']
  const grouped = groupByFolder(dir, paths)
  for (const [key, group] of grouped.groups) {
    const owned: string[] = []
    for (const path of group) {
      const rest = path.slice(`${dir}/${key}/`.length)
      const doc = rest.startsWith(`${DOCS_FOLDER}/`) ? rest.slice(DOCS_FOLDER.length + 1) : null
      if (rest === DECLARATION_FILE || (doc !== null && doc.length > 0 && !doc.includes('/'))) {
        owned.push(path)
        continue
      }
      grouped.diagnostics.push(
        fileFinding(
          'E_DECL_UNKNOWN_FILE',
          key,
          path,
          `${path} belongs to no knowledge base file.`,
          `knowledge/${key}/ holds ${DECLARATION_FILE} and documents directly in ${DOCS_FOLDER}/ (no subfolders).`
        )
      )
    }
    grouped.groups.set(key, owned)
  }
  return grouped
}

function printChunking(chunking: KnowledgeChunkingDecl): Json {
  const value: Record<string, Json> = {}
  if (chunking.maxSize !== undefined) value.maxSize = chunking.maxSize
  if (chunking.minSize !== undefined) value.minSize = chunking.minSize
  if (chunking.overlap !== undefined) value.overlap = chunking.overlap
  if (chunking.strategy !== undefined) value.strategy = chunking.strategy
  if (chunking.strategyOptions !== undefined) {
    const { pattern, separators, recipe, strictBoundaries } = chunking.strategyOptions
    const options: Record<string, Json> = {}
    if (pattern !== undefined) options.pattern = pattern
    if (separators !== undefined) options.separators = separators
    if (recipe !== undefined) options.recipe = recipe
    if (strictBoundaries !== undefined) options.strictBoundaries = strictBoundaries
    value.strategyOptions = options
  }
  return value
}

/** The chunking a declaration resolves to: undeclared sizes are the defaults. */
export function canonicalChunking(chunking: KnowledgeChunkingDecl | undefined): Json {
  const options: Record<string, Json> = {}
  const declared = chunking?.strategyOptions
  if (declared?.pattern !== undefined) options.pattern = declared.pattern
  if (declared?.separators !== undefined) options.separators = declared.separators
  if (declared?.recipe !== undefined) options.recipe = declared.recipe
  if (declared?.strictBoundaries === true) options.strictBoundaries = true
  return {
    maxSize: chunking?.maxSize ?? DEFAULT_CHUNKING.maxSize,
    minSize: chunking?.minSize ?? DEFAULT_CHUNKING.minSize,
    overlap: chunking?.overlap ?? DEFAULT_CHUNKING.overlap,
    strategy: chunking?.strategy ?? null,
    strategyOptions: Object.keys(options).length > 0 ? options : null,
  }
}

/** Reads and prints `knowledge/<key>/`. */
export const knowledgeCodec: KindCodec<KnowledgeBaseDecl> = {
  group: groupKnowledge,
  parse: parseKnowledgeBase,
  print(key, decl) {
    const value: Record<string, Json> = { name: decl.name }
    if (decl.description !== undefined) value.description = decl.description
    if (decl.folder !== undefined) value.folder = decl.folder
    if (decl.chunking !== undefined) value.chunking = printChunking(decl.chunking)
    if (decl.embeddingModel !== undefined) value.embeddingModel = decl.embeddingModel
    return {
      text: { [knowledgeDeclarationPath(key)]: printDeclaration(CALLEE, value) },
      blobs: Object.entries(decl.docs)
        .sort(([a], [b]) => compareStrings(a, b))
        .map(([name, doc]) => ({ path: knowledgeDocPath(key, name), ...doc })),
    }
  },
  /** The embedding model is left out: it never changes, and a changed one is refused outright. */
  canonical: (decl) => ({
    name: decl.name,
    description: decl.description || null,
    folder: decl.folder ?? '/',
    chunking: canonicalChunking(decl.chunking),
    docs: Object.fromEntries(Object.entries(decl.docs).map(([name, doc]) => [name, doc.sha256])),
  }),
}
