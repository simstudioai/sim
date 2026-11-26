import { compareStrings } from '@sim/utils/string'
import { collectStringLeaves } from '@sim/utils/workflow-references'
import {
  type BlockKey,
  type CanonicalBlock,
  type CompileResult,
  codeFileLanguage,
  codeFileRefs,
  didYouMean,
  encodeAnchor,
  fromCodeFile,
  LineIndex,
  referencedHeads,
  type StoredEdgeRef,
} from '@sim/workflow-code'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import type { Command } from 'commander'
import { printLine } from '#sim-cli/output/io'
import { actingProfileFrom } from '../../context'
import { CliUsageError } from './local-errors'
import { printProtocolResult } from './result'
import { compileWorkflowDir } from './source-check'
import { assertSourceDirKind, sourceRelativePath } from './source-dir'
import { isMachine } from './source-ui'
import { lookupCatalog } from './workflow-source-params'

/** The most blocks one find prints, so a broad match stays readable. */
const MAX_FOUND = 20

const FIND_HELP = `
Prints each block the name matches, read from the directory alone (no request is made): its
declaration in workflow.ts with line numbers, its function file, the wiring statements of its
incoming and outgoing edges, and every block that reads its outputs (a param, a branch, or a
function file's $ref), each as file:line. <block> is a block name (Security Score), its key
(securityscore) or its identifier (securityScore); with no exact match, every block whose name
contains it is printed (at most ${MAX_FOUND}). Run it from a workflow source directory, or pass --dir.

Exit codes: 0 printed; 1 no block matches (the closest name is suggested), or the
directory is not a workflow source directory.`

interface Located {
  file: string
  line: number
}

interface FoundEdge extends Located {
  block: string
  port: StoredEdgeRef['port']
  statement: string
}

interface Reader extends Located {
  block: string
  field: string
}

interface FoundBlock extends Located {
  name: string
  key: BlockKey
  ident: string
  type: string | null
  endLine: number
  codeFile: string | null
  incoming: FoundEdge[]
  outgoing: FoundEdge[]
  readers: Reader[]
}

const byLine = (a: Located, b: Located) => compareStrings(a.file, b.file) || a.line - b.line

/** A compiled source directory, each file's lines indexed once, with the lookups find needs. */
class SourceIndex {
  private readonly indexes = new Map<string, LineIndex>()

  constructor(
    readonly compiled: CompileResult,
    private readonly files: Readonly<Record<string, string>>
  ) {}

  keys(): BlockKey[] {
    return Object.keys(this.compiled.hints.blocks)
  }

  nameOf(key: BlockKey): string {
    return this.compiled.workflow?.blocks[key]?.name ?? key
  }

  identOf(key: BlockKey): string {
    return this.compiled.hints.blocks[key]?.ident ?? key
  }

  codeFileOf(key: BlockKey): string | null {
    const path = this.compiled.hints.blocks[key]?.codeFile
    return path ? sourceRelativePath(path) : null
  }

  span(anchor: Parameters<typeof encodeAnchor>[0]) {
    return this.compiled.spans[encodeAnchor(anchor)]
  }

  /** The line index of `file` (split as compile counts lines), or `null` when it is not read. */
  linesOf(file: string): LineIndex | null {
    const text = this.files[file]
    if (text === undefined) return null
    let index = this.indexes.get(file)
    if (!index) {
      index = new LineIndex(text)
      this.indexes.set(file, index)
    }
    return index
  }
}

/** Every string a block's params, branches and subflow config hold, by the field that holds it. */
function blockFields(block: CanonicalBlock): Array<{ field: string; texts: string[] }> {
  const fields: Array<{ field: string; value: unknown }> = Object.entries(block.params).map(
    ([id, param]) => ({ field: id, value: param.kind === 'value' ? param.value : param.tools })
  )
  for (const row of block.branches?.rows ?? []) fields.push({ field: row.key, value: row.value })
  if (block.subflow) fields.push({ field: block.subflow.kind, value: block.subflow })
  return fields.map(({ field, value }) => {
    const texts: string[] = []
    collectStringLeaves(value, texts)
    return { field, texts }
  })
}

/**
 * Every block's readers, by the key they read, from one pass over the workflow: a function file
 * by the lines its `$ref` names the block on, any other field by its span.
 */
function readersByKey(index: SourceIndex): Map<BlockKey, Reader[]> {
  const readers = new Map<BlockKey, Reader[]>()
  const add = (key: BlockKey, reader: Reader) => {
    const list = readers.get(key)
    if (list) list.push(reader)
    else readers.set(key, [reader])
  }
  for (const [readerKey, block] of Object.entries(index.compiled.workflow?.blocks ?? {})) {
    const codeFile = index.codeFileOf(readerKey)
    const codeLines = codeFile ? index.linesOf(codeFile) : null
    for (const { field, texts } of blockFields(block)) {
      const heads = new Set(texts.flatMap(referencedHeads))
      heads.delete(readerKey)
      if (heads.size === 0) continue
      if (field === 'code' && codeFile && codeLines) {
        const parsed = fromCodeFile(codeLines.text, codeFileLanguage(codeFile) ?? 'javascript')
        for (const ref of codeFileRefs(parsed.ok ? parsed.refs : [], codeLines.text)) {
          const [head] = ref.kind === 'ref' ? ref.segments : []
          if (head?.kind !== 'name' || !heads.has(head.name)) continue
          const { line } = codeLines.position(ref.start)
          add(head.name, { block: block.name, field, file: codeFile, line })
        }
        continue
      }
      const at =
        index.span({ kind: 'param', block: readerKey, param: field }) ??
        index.span({ kind: 'block', block: readerKey })
      for (const head of heads) {
        add(head, {
          block: block.name,
          field,
          file: at?.file ?? SOURCE_ENTRY_FILE,
          line: at?.line ?? 0,
        })
      }
    }
  }
  return readers
}

/**
 * The blocks `query` names: an exact key, identifier or name first, else every block whose name
 * contains the query.
 */
function matchBlocks(index: SourceIndex, query: string): BlockKey[] {
  const normalized = normalizeWorkflowBlockName(query)
  const exact = index.keys().filter((key) => key === normalized || index.identOf(key) === query)
  if (exact.length > 0) return exact
  const needle = query.toLowerCase()
  return index
    .keys()
    .filter((key) => key.includes(normalized) || index.nameOf(key).toLowerCase().includes(needle))
}

/** The refusal for a query no block matches, naming the closest block. */
function unknownBlock(index: SourceIndex, query: string): CliUsageError {
  const names = index
    .keys()
    .map((key) => index.nameOf(key))
    .sort(compareStrings)
  const hint = didYouMean(query, names) ?? `It has ${names.length} blocks.`
  return new CliUsageError(`No block is named ${query}. ${hint}`, { code: 'BLOCK_UNKNOWN' })
}

function describeBlock(
  index: SourceIndex,
  readers: ReadonlyMap<BlockKey, Reader[]>,
  key: BlockKey
): FoundBlock {
  const span = index.span({ kind: 'block', block: key })
  const { edges, edgeSpans } = index.compiled
  const edge = (at: number, other: BlockKey): FoundEdge => {
    const ref = edges[at]
    const written = edgeSpans[at]
    return {
      block: index.nameOf(other),
      port: ref.port,
      file: written?.file ?? SOURCE_ENTRY_FILE,
      line: written?.line ?? span?.line ?? 0,
      statement: written
        ? (index.linesOf(written.file)?.lines[written.line - 1]?.trim() ?? '')
        : '',
    }
  }
  const ends = (side: 'from' | 'to', other: 'from' | 'to') =>
    edges.flatMap((ref, at) => (ref[side] === key ? [edge(at, ref[other])] : [])).sort(byLine)
  return {
    name: index.nameOf(key),
    key,
    ident: index.identOf(key),
    type: index.compiled.workflow?.blocks[key]?.type ?? null,
    file: span?.file ?? SOURCE_ENTRY_FILE,
    line: span?.line ?? 0,
    endLine: span?.endLine ?? 0,
    codeFile: index.codeFileOf(key),
    incoming: ends('to', 'from'),
    outgoing: ends('from', 'to'),
    readers: [...(readers.get(key) ?? [])].sort(byLine),
  }
}

function printFound(index: SourceIndex, found: FoundBlock): void {
  const kind = found.type ? `${found.type}, ` : ''
  printLine(`${found.name} (${kind}key ${found.key}, ${found.ident})`)
  const lines = index.linesOf(found.file)?.lines ?? []
  const width = String(found.endLine).length
  for (let line = Math.max(found.line, 1); line <= found.endLine; line += 1) {
    printLine(`${String(line).padStart(width)}  ${lines[line - 1] ?? ''}`)
  }
  if (found.codeFile) printLine(`code: ${found.codeFile}`)
  const section = (label: string, rows: string[]) => {
    printLine(rows.length === 0 ? `${label}: none` : `${label}:`)
    for (const row of rows) printLine(`  ${row}`)
  }
  const edgeRow = (edge: FoundEdge) => `${edge.file}:${edge.line}  ${edge.statement}`
  section('in', found.incoming.map(edgeRow))
  section('out', found.outgoing.map(edgeRow))
  section(
    'read by',
    found.readers.map(
      (reader) => `${reader.file}:${reader.line}  ${reader.block} (${reader.field})`
    )
  )
}

/**
 * `sim workflows source find <block> [--dir <dir>]`: one block's code, function file, edges and
 * readers with their lines, from the directory alone, so locating a block in a long workflow is
 * one command instead of rounds of search.
 */
export function attachWorkflowSourceFind(source: Command): void {
  source
    .command('find')
    .argument('<block>', 'Block name, key or identifier; a part of a name matches every block')
    .option('--dir <dir>', 'Workflow source directory to read', '.')
    .allowExcessArguments(false)
    .description("Print a block's code, edges and readers with line numbers (offline)")
    .addHelpText('after', FIND_HELP)
    .action(async (query: string, options: { dir: string }, command: Command) => {
      const profile = actingProfileFrom(command)
      await assertSourceDirKind(options.dir, 'workflow')
      const catalog = await lookupCatalog(options.dir, profile)
      const { compiled, files } = await compileWorkflowDir(options.dir, catalog)
      const index = new SourceIndex(compiled, files)
      const keys = matchBlocks(index, query)
      if (keys.length === 0) throw unknownBlock(index, query)
      const readers = readersByKey(index)
      const found = keys
        .slice(0, MAX_FOUND)
        .map((key) => describeBlock(index, readers, key))
        .sort(byLine)
      const more = keys.length - found.length
      if (isMachine(profile.output)) {
        printProtocolResult(profile.output, { blocks: found, ...(more > 0 ? { more } : {}) })
        return
      }
      if (compiled.workflow === null) {
        printLine('The source has compile errors, so readers are left out: run `source check`.')
      }
      found.forEach((block, position) => {
        if (position > 0) printLine('')
        printFound(index, block)
      })
      if (more > 0) printLine(`\n${more} more blocks match; name one exactly to print it.`)
    })
}
