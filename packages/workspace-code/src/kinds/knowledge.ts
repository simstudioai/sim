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
import { hasSuspiciousCharacter, type Json } from '@sim/workflow-code'
import {
  asDeclared,
  booleanField,
  canonicalFields,
  type DeclField,
  type DeclFields,
  folderField,
  objectField,
  printFields,
  readFields,
  stringField,
} from '../declaration/field-table'
import {
  fieldPointer,
  fieldReporter,
  isOneOf,
  readObject,
  readStringField,
} from '../declaration/fields'
import { printDeclaration } from '../declaration/print'
import { readDeclaration } from '../declaration/read'
import {
  diagnostic,
  MAX_FINDINGS_PER_FILE,
  resourceOf,
  type WorkspaceDiagnostic,
  wholeFile,
} from '../diagnostics'
import { type BlobEntry, isWellFormedBlob, KIND_DIRS, type KindCodec } from '../kind'
import { WORKSPACE_SOURCE_LIMITS } from '../limits'
import { filePathProblem, foldedFileKey } from './files'
import { groupByFolder } from './group'

/**
 * Chunking strategies. Mirrors `ChunkingStrategy` (apps/sim/lib/chunkers/types), which an apps/sim
 * test holds this equal to, as it does every mirrored constant here.
 */
export const CHUNKING_STRATEGIES = [
  'auto',
  'text',
  'regex',
  'recursive',
  'sentence',
  'token',
] as const
/** Recursive chunking recipes. Mirrors `RecursiveRecipe` (apps/sim/lib/chunkers/types). */
export const RECURSIVE_RECIPES = ['plain', 'markdown', 'code'] as const

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
 * The chunking a knowledge base gets when none is declared: what its fingerprint assumes and what
 * an apply creates it with. Mirrors `DEFAULT_CHUNKING_CONFIG` (apps/sim/lib/knowledge/constants),
 * so an undeclared and a spelled-out default agree.
 */
export const DEFAULT_CHUNKING = { maxSize: 1024, minSize: 100, overlap: 200 } as const

/** Mirrors `KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH` (apps/sim/lib/knowledge/constants). */
export const KNOWLEDGE_DESCRIPTION_MAX_LENGTH = 10_000

const CALLEE = 'defineKnowledgeBase'
const DECLARATION_FILE = 'knowledge.ts'
const DOCS_FOLDER = 'docs'

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

/** A chunk size: a whole number. */
const sizeField: DeclField<number | undefined> = {
  read(value, field, pointer, report) {
    const raw = value[field]
    if (raw === undefined) return undefined
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      report('E_DECL_SHAPE', fieldPointer(pointer, field), `"${field}" must be a whole number.`)
      return undefined
    }
    return raw
  },
  print: asDeclared,
  canonical: asDeclared,
}

/** One of `allowed`, fingerprinted as declared or as `null` when not. */
function enumField<T extends string>(allowed: readonly T[]): DeclField<T | undefined> {
  return {
    read(value, field, pointer, report) {
      const raw = readStringField(value, field, pointer, report)
      if (raw === undefined) return undefined
      if (isOneOf(allowed, raw)) return raw
      report(
        'E_DECL_SHAPE',
        fieldPointer(pointer, field),
        `"${field}" is one of ${allowed.join(', ')}.`
      )
      return undefined
    },
    print: asDeclared,
    canonical: (choice) => choice ?? null,
  }
}

type StrategyOptionsDecl = NonNullable<KnowledgeChunkingDecl['strategyOptions']>

const STRATEGY_OPTION_FIELDS: DeclFields<StrategyOptionsDecl> = {
  pattern: stringField(),
  separators: {
    read(value, field, pointer, report) {
      const separators = value[field]
      if (separators === undefined) return undefined
      if (Array.isArray(separators)) {
        const strings = separators.filter((item) => typeof item === 'string')
        if (strings.length === separators.length) return strings
      }
      report(
        'E_DECL_SHAPE',
        fieldPointer(pointer, field),
        '"separators" must be a list of strings.'
      )
      return undefined
    },
    print: asDeclared,
    canonical: asDeclared,
  },
  recipe: { ...enumField(RECURSIVE_RECIPES), canonical: asDeclared },
  /** Off is the default, so only `true` is fingerprinted. */
  strictBoundaries: booleanField((strict) => (strict === true ? true : undefined)),
}

const CHUNKING_FIELDS: DeclFields<KnowledgeChunkingDecl> = {
  maxSize: sizeField,
  minSize: sizeField,
  overlap: sizeField,
  strategy: enumField(CHUNKING_STRATEGIES),
  strategyOptions: objectField(STRATEGY_OPTION_FIELDS, (options) => {
    const canonical = canonicalFields(STRATEGY_OPTION_FIELDS, options ?? {})
    return Object.keys(canonical).length > 0 ? canonical : null
  }),
}

/**
 * The fields of `knowledge.ts`. The embedding model is left out of the fingerprint: it never
 * changes, and a changed one is refused outright.
 */
const KNOWLEDGE_FIELDS: DeclFields<Omit<KnowledgeBaseDecl, 'docs'>> = {
  name: stringField({ required: true, name: true }),
  description: stringField(
    { maxLength: KNOWLEDGE_DESCRIPTION_MAX_LENGTH },
    (description) => description || null
  ),
  folder: folderField('/support'),
  chunking: objectField(CHUNKING_FIELDS, (chunking) => canonicalChunking(chunking)),
  embeddingModel: { ...stringField(), canonical: null },
}

function fileFinding(
  code:
    | 'E_KB_DOC_NAME'
    | 'E_DECL_SHAPE'
    | 'E_LIMIT_EXCEEDED'
    | 'E_DECL_UNKNOWN_FILE'
    | 'W_DECL_SUSPICIOUS_CHARACTER',
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

/**
 * `findings` about a knowledge base's document files, past {@link MAX_FINDINGS_PER_FILE} folded
 * into one `I_FINDINGS_TRUNCATED`: a folder of bad documents costs no more than its first
 * hundred, and refuses for what those hundred are, not as a size limit. Errors are kept before
 * warnings, so a refusal is never folded away behind a hundred warnings.
 */
function cappedFileFindings(key: string, findings: WorkspaceDiagnostic[]): WorkspaceDiagnostic[] {
  if (findings.length <= MAX_FINDINGS_PER_FILE) return findings
  const errors = findings.filter((finding) => finding.severity === 'error')
  const rest = findings.filter((finding) => finding.severity !== 'error')
  return [
    ...[...errors, ...rest].slice(0, MAX_FINDINGS_PER_FILE),
    diagnostic(
      'I_FINDINGS_TRUNCATED',
      `Stopped after ${MAX_FINDINGS_PER_FILE} findings about the files in knowledge/${key}/.`,
      { kind: 'knowledge-base', key, hint: 'Fix these and apply again to see the rest.' }
    ),
  ]
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
    } else if (!isWellFormedBlob(blob)) {
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
      if (hasSuspiciousCharacter(name)) {
        diagnostics.push(
          fileFinding(
            'W_DECL_SUSPICIOUS_CHARACTER',
            key,
            blob.path,
            `${blob.path} holds an invisible bidi control or zero-width character, so it reads differently from its name.`,
            'Rename it so the document name shows every character it holds.'
          )
        )
      }
      folded.set(foldedFileKey(name), name)
      docs.push([name, { sha256: blob.sha256, size: blob.size }])
    }
  }
  // `fromEntries` defines own properties, so a document named `__proto__` stays a document.
  return Object.fromEntries(docs)
}

function parseKnowledgeBase(
  key: string,
  text: Readonly<Record<string, string>>,
  blobs: readonly BlobEntry[]
): { decl?: KnowledgeBaseDecl; diagnostics: WorkspaceDiagnostic[] } {
  const file = knowledgeDeclarationPath(key)
  const resource = resourceOf('knowledge-base', key)
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
  const fileFindings: WorkspaceDiagnostic[] = []
  // A document sent as text would be missing from `docs`, which reads as a request to delete it.
  for (const path of Object.keys(text)) {
    if (path === file) continue
    fileFindings.push(
      fileFinding(
        'E_DECL_SHAPE',
        key,
        path,
        `${path} was sent as text; a knowledge document travels as a blob, by hash.`
      )
    )
  }
  const docs = readDocs(key, blobs, fileFindings)
  diagnostics.push(...cappedFileFindings(key, fileFindings))
  if (read.value === undefined) return { diagnostics }
  const report = fieldReporter(source, read.spans, diagnostics, resource)
  const value = readObject(read.value, '', report, `${CALLEE}()`)
  if (!value) return { diagnostics }
  const { name, ...fields } = readFields(KNOWLEDGE_FIELDS, value, '', report)
  if (diagnostics.some((finding) => finding.severity === 'error') || name === undefined) {
    return { diagnostics }
  }
  return { decl: { name, ...fields, docs }, diagnostics }
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

/**
 * The chunking a knowledge base gets from a declaration: what it declares, with each undeclared
 * size the default. An apply creates and updates with it, and the fingerprint is taken of it, so
 * an undeclared and a spelled-out default agree.
 */
export function resolvedChunking(
  chunking: KnowledgeChunkingDecl | undefined
): KnowledgeChunkingDecl &
  Pick<Required<KnowledgeChunkingDecl>, 'maxSize' | 'minSize' | 'overlap'> {
  return {
    ...chunking,
    maxSize: chunking?.maxSize ?? DEFAULT_CHUNKING.maxSize,
    minSize: chunking?.minSize ?? DEFAULT_CHUNKING.minSize,
    overlap: chunking?.overlap ?? DEFAULT_CHUNKING.overlap,
  }
}

/** The canonical JSON of the chunking a declaration resolves to ({@link resolvedChunking}). */
export function canonicalChunking(chunking: KnowledgeChunkingDecl | undefined): Json {
  return canonicalFields(CHUNKING_FIELDS, resolvedChunking(chunking))
}

/** A document's path, `knowledge/<key>/docs/<name>`: the kind's only binary files. */
const DOCUMENT_PATH = new RegExp(`^${KIND_DIRS['knowledge-base']}/[^/]+/${DOCS_FOLDER}/[^/]+$`)

/** Reads and prints `knowledge/<key>/`. */
export const knowledgeCodec: KindCodec<KnowledgeBaseDecl> = {
  isBlob: (path) => DOCUMENT_PATH.test(path),
  group: groupKnowledge,
  baseBlobName: (key, path) => path.slice(knowledgeDocPath(key, '').length),
  baseBlobPath: knowledgeDocPath,
  parse: parseKnowledgeBase,
  print(key, decl) {
    const value = printFields(KNOWLEDGE_FIELDS, decl)
    return {
      text: { [knowledgeDeclarationPath(key)]: printDeclaration(CALLEE, value) },
      blobs: Object.entries(decl.docs)
        .sort(([a], [b]) => compareStrings(a, b))
        .map(([name, doc]) => ({ path: knowledgeDocPath(key, name), ...doc })),
    }
  },
  canonical: (decl) => ({
    ...canonicalFields(KNOWLEDGE_FIELDS, decl),
    docs: Object.fromEntries(Object.entries(decl.docs).map(([name, doc]) => [name, doc.sha256])),
  }),
}
