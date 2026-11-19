#!/usr/bin/env bun

/**
 * Exports a redacted, block-type-stratified sample of stored workflows for the round-trip corpus.
 * The output never belongs in this public repo: the script refuses any output directory inside the
 * repository.
 *
 * Sampling: for every `(block type, trigger mode)` pair the database holds, up to `--per-type`
 * workflows are drawn (ordered by a hash of the id, so a re-run picks the same ones), then the
 * pools are interleaved round-robin and cut at `--limit`, so a small limit still spreads across
 * types instead of filling up with the most common one.
 *
 * Redaction keeps what the round trip is about and nothing else:
 * - kept: object keys, ids (UUIDs and `id`/`*Id`/`*_id` fields), credential references, block and
 *   subBlock `type`, edge handles, dropdown/operation option ids, numbers, booleans, `null`, and
 *   URL scheme and host (each path segment is redacted like text, keeping its `/` shape; query
 *   and fragment become `redacted`);
 * - rewritten consistently: block and variable names become `<type> <n>` / `var<n>`, and every
 *   `<name.path>` / `<variable.name>` reference follows;
 * - redacted: every other string. Letters become `x`, digits `0`; whitespace, newlines,
 *   punctuation, backticks, `${`, `<...>` references and `{{ENV}}` tokens survive, so escaping
 *   quirks stay in the corpus. A `<...>` run survives only when its root is a block name, a
 *   variable reference or a reserved prefix (`<loop.index>`); anything else (`<jane@acme.com>`)
 *   is redacted as text. JSON-text values are redacted inside and re-encoded. Fields whose
 *   key looks like a secret (`apiKey`, `token`, `password`, ...) become `REDACTED`.
 *
 * The states are exported raw (pre-migration), as stored rows; the harness applies no migration.
 *
 * Usage (never run against production from a laptop; use the sanctioned read replica):
 *   EXPORT_DATABASE_URL=... bun run apps/sim/scripts/export-redacted-workflows.ts \
 *     --out /abs/path/outside/repo --limit 200 [--per-type 3]
 * Then: ROUNDTRIP_CORPUS_EXTRA_DIR=/abs/path/outside/repo bun run --cwd apps/sim test \
 *   lib/workflows/code/corpus/roundtrip.corpus.test.ts
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { compareStrings, escapeRegExp } from '@sim/utils/string'
import {
  normalizeWorkflowBlockName,
  RESERVED_WORKFLOW_BLOCK_NAMES,
} from '@sim/workflow-types/workflow'
import postgres from 'postgres'

const logger = createLogger('ExportRedactedWorkflows', { enabled: true, logLevel: 'INFO' })

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
/** Positional branch titles and pair modes are structure, not prose. */
const STRUCTURAL_VALUE = /^(if|else if|else|Route \d+|basic|advanced)$/i

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID_KEY = /^(id|nodes|.*Id|.*_id|.*Ids)$/
const CREDENTIAL_KEY = /credential/i
const SECRET_KEY =
  /(api[-_]?key|token|secret|password|private[-_]?key|bearer|authorization|signing)/i
const STRUCTURAL_KEYS = new Set([
  'type',
  'sourceHandle',
  'targetHandle',
  'loopType',
  'parallelType',
  'extent',
  'role',
  'language',
  'usageControl',
  'operation',
  'toolId',
  'fieldType',
  'operator',
  'logicalOperator',
  'direction',
  'mode',
])
/** SubBlock types whose stored value is an option id or a picked resource id, never prose. */
const ID_VALUED_SUBBLOCK_TYPES = new Set([
  'dropdown',
  'oauth-input',
  'file-selector',
  'sheet-selector',
  'project-selector',
  'channel-selector',
  'user-selector',
  'folder-selector',
  'knowledge-base-selector',
  'document-selector',
  'mcp-server-selector',
  'mcp-tool-selector',
  'workflow-selector',
  'table-selector',
  'column-selector',
])

/** Reference candidates and env tokens are split out of text before redaction. */
const PROTECTED_TOKEN = /(<[^<>\s]+>|\{\{[^{}]+\}\}|\$\{)/g
/** Splits an http(s) URL into origin, path, query and fragment without re-encoding the path. */
const URL_PARTS = /^(https?:\/\/[^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i

interface Args {
  out: string
  limit: number
  perType: number
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      limit: { type: 'string' },
      'per-type': { type: 'string', default: '3' },
    },
  })
  if (!values.out) throw new Error('--out <directory outside the repo> is required')
  const limit = Number(values.limit)
  const perType = Number(values['per-type'])
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limit must be a positive integer')
  if (!Number.isInteger(perType) || perType <= 0)
    throw new Error('--per-type must be a positive integer')
  return { out: path.resolve(values.out), limit, perType }
}

export function assertOutsideRepo(directory: string): void {
  mkdirSync(directory, { recursive: true })
  const real = realpathSync(directory)
  const repo = realpathSync(REPO_ROOT)
  if (real === repo || real.startsWith(`${repo}${path.sep}`)) {
    throw new Error(`Refusing to write redacted production data inside the repo (${real})`)
  }
}

function maskCharacters(text: string): string {
  return text.replace(/\p{L}/gu, 'x').replace(/\p{N}/gu, '0')
}

export class Redactor {
  private readonly renames = new Map<string, string>()
  private renamePattern: RegExp | null = null
  private readonly referenceRoots: ReadonlySet<string>

  constructor(blockNames: Map<string, string>, variableNames: Map<string, string>) {
    this.referenceRoots = new Set<string>([
      ...blockNames.values(),
      ...RESERVED_WORKFLOW_BLOCK_NAMES,
    ])
    for (const [from, to] of blockNames) this.renames.set(`<${from}.`, `<${to}.`)
    for (const [from, to] of blockNames) this.renames.set(`<${from}>`, `<${to}>`)
    for (const [from, to] of variableNames)
      this.renames.set(`<variable.${from}>`, `<variable.${to}>`)
    for (const [from, to] of variableNames)
      this.renames.set(`<variable.${from}.`, `<variable.${to}.`)
    const keys = [...this.renames.keys()].sort((a, b) => b.length - a.length)
    if (keys.length > 0) this.renamePattern = new RegExp(keys.map(escapeRegExp).join('|'), 'gi')
  }

  private rewriteRefs(text: string): string {
    if (!this.renamePattern) return text
    return text.replace(this.renamePattern, (match) => {
      const key = [...this.renames.keys()].find((k) => k.toLowerCase() === match.toLowerCase())
      return key ? (this.renames.get(key) ?? match) : match
    })
  }

  private isReference(token: string): boolean {
    if (!token.startsWith('<')) return true
    const root = token.slice(1, -1).split('.')[0] ?? ''
    return this.referenceRoots.has(normalizeWorkflowBlockName(root))
  }

  private redactText(text: string): string {
    return text
      .split(PROTECTED_TOKEN)
      .map((part, i) => (i % 2 === 1 && this.isReference(part) ? part : maskCharacters(part)))
      .join('')
  }

  private redactUrl(text: string): string | null {
    const parts = URL_PARTS.exec(text)
    if (!parts || !URL.canParse(text)) return null
    const [, origin, pathname = '', query, hash] = parts
    const path = this.redactText(this.rewriteRefs(pathname))
    return `${origin}${path}${query ? '?redacted' : ''}${hash ? '#redacted' : ''}`
  }

  string(text: string, key: string | null): string {
    if (key && SECRET_KEY.test(key) && !CREDENTIAL_KEY.test(key)) return text ? 'REDACTED' : text
    if (UUID.test(text) || STRUCTURAL_VALUE.test(text)) return text
    if (key && (ID_KEY.test(key) || CREDENTIAL_KEY.test(key) || STRUCTURAL_KEYS.has(key)))
      return text
    const url = this.redactUrl(text.trim())
    if (url !== null) return url
    const trimmed = text.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        const indent = /\n(\s+)"/.exec(text)?.[1]?.length ?? 0
        return JSON.stringify(this.value(parsed, key), null, indent || undefined)
      } catch {
        // Not JSON: fall through to text redaction.
      }
    }
    return this.redactText(this.rewriteRefs(text))
  }

  value(node: unknown, key: string | null): unknown {
    if (typeof node === 'string') return this.string(node, key)
    if (Array.isArray(node)) return node.map((item) => this.value(item, key))
    if (isRecordLike(node)) {
      const out: Record<string, unknown> = {}
      for (const [childKey, child] of Object.entries(node))
        out[childKey] = this.value(child, childKey)
      return out
    }
    return node
  }

  subBlockValue(subBlock: unknown, subBlockId: string): unknown {
    if (!isRecordLike(subBlock)) return subBlock
    const type = typeof subBlock.type === 'string' ? subBlock.type : ''
    const value =
      ID_VALUED_SUBBLOCK_TYPES.has(type) && !SECRET_KEY.test(subBlockId)
        ? subBlock.value
        : this.value(subBlock.value, subBlockId)
    return { ...subBlock, value }
  }
}

interface BlockRow {
  id: string
  type: string
  name: string
  position_x: string
  position_y: string
  enabled: boolean
  horizontal_handles: boolean
  advanced_mode: boolean
  trigger_mode: boolean
  error_enabled: boolean
  retry: unknown
  locked: boolean
  height: string
  sub_blocks: Record<string, unknown>
  outputs: Record<string, unknown>
  data: Record<string, unknown> | null
}

async function exportWorkflow(sql: postgres.Sql, workflowId: string, variablesRaw: unknown) {
  const [blocks, edges, subflows] = await Promise.all([
    sql<BlockRow[]>`SELECT * FROM workflow_blocks WHERE workflow_id = ${workflowId} ORDER BY id`,
    sql<
      Array<{
        id: string
        source_block_id: string
        target_block_id: string
        source_handle: string | null
        target_handle: string | null
      }>
    >`SELECT * FROM workflow_edges WHERE workflow_id = ${workflowId} ORDER BY id`,
    sql<Array<{ id: string; type: string; config: Record<string, unknown> }>>`
      SELECT * FROM workflow_subflows WHERE workflow_id = ${workflowId} ORDER BY id`,
  ])

  const blockNames = new Map<string, string>()
  const renamed = new Map<string, string>()
  const perType = new Map<string, number>()
  for (const block of blocks) {
    const n = (perType.get(block.type) ?? 0) + 1
    perType.set(block.type, n)
    const name = `${block.type} ${n}`
    renamed.set(block.id, name)
    blockNames.set(normalizeWorkflowBlockName(block.name), normalizeWorkflowBlockName(name))
  }

  const variables = toRecord(variablesRaw)
  const variableNames = new Map<string, string>()
  const variableRenames = new Map<string, string>()
  Object.entries(variables).forEach(([id, variable], i) => {
    if (!isRecordLike(variable) || typeof variable.name !== 'string') return
    variableNames.set(normalizeWorkflowBlockName(variable.name), `var${i}`)
    variableRenames.set(id, `var${i}`)
  })

  const redactor = new Redactor(blockNames, variableNames)

  const stateBlocks: Record<string, unknown> = {}
  for (const block of blocks) {
    const subBlocks: Record<string, unknown> = {}
    for (const [id, subBlock] of Object.entries(block.sub_blocks ?? {})) {
      subBlocks[id] = redactor.subBlockValue(subBlock, id)
    }
    stateBlocks[block.id] = {
      id: block.id,
      type: block.type,
      name: renamed.get(block.id),
      position: { x: Number(block.position_x), y: Number(block.position_y) },
      subBlocks,
      outputs: redactor.value(block.outputs ?? {}, 'outputs'),
      enabled: block.enabled,
      horizontalHandles: block.horizontal_handles,
      advancedMode: block.advanced_mode,
      triggerMode: block.trigger_mode,
      errorEnabled: block.error_enabled,
      ...(block.retry ? { retry: block.retry } : {}),
      locked: block.locked,
      height: Number(block.height),
      data: redactor.value(block.data ?? {}, 'data'),
    }
  }

  const loops: Record<string, unknown> = {}
  const parallels: Record<string, unknown> = {}
  for (const subflow of subflows) {
    const config = redactor.value(subflow.config, 'config')
    if (subflow.type === 'loop') loops[subflow.id] = config
    else if (subflow.type === 'parallel') parallels[subflow.id] = config
  }

  const redactedVariables: Record<string, unknown> = {}
  for (const [id, variable] of Object.entries(variables)) {
    if (!isRecordLike(variable)) continue
    redactedVariables[id] = {
      ...variable,
      name: variableRenames.get(id) ?? 'var',
      value: redactor.value(variable.value, 'value'),
    }
  }

  return {
    blocks: stateBlocks,
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source_block_id,
      target: edge.target_block_id,
      sourceHandle: edge.source_handle,
      targetHandle: edge.target_handle,
    })),
    loops,
    parallels,
    variables: redactedVariables,
  }
}

/** Interleaves per-type pools round-robin, de-duplicating, until `limit` ids are chosen. */
export function stratify(pools: Map<string, string[]>, limit: number): string[] {
  const chosen: string[] = []
  const seen = new Set<string>()
  const queues = [...pools.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([, ids]) => [...ids])
  while (chosen.length < limit && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      if (chosen.length >= limit) break
      while (queue.length > 0) {
        const id = queue.shift()
        if (id && !seen.has(id)) {
          seen.add(id)
          chosen.push(id)
          break
        }
      }
    }
  }
  return chosen
}

async function main(): Promise<void> {
  const args = parseCliArgs()
  assertOutsideRepo(args.out)
  const connectionString = process.env.EXPORT_DATABASE_URL
  if (!connectionString) throw new Error('EXPORT_DATABASE_URL is required')

  const sql = postgres(connectionString, {
    prepare: false,
    max: 4,
    connect_timeout: 30,
    onnotice: () => {},
  })
  try {
    const sampled = await sql<Array<{ type: string; trigger_mode: boolean; workflow_id: string }>>`
      SELECT type, trigger_mode, workflow_id FROM (
        SELECT b.type, b.trigger_mode, b.workflow_id,
          row_number() OVER (PARTITION BY b.type, b.trigger_mode ORDER BY md5(b.workflow_id)) AS rn
        FROM (SELECT DISTINCT type, trigger_mode, workflow_id FROM workflow_blocks) b
        JOIN workflow w ON w.id = b.workflow_id
        WHERE w.archived_at IS NULL
      ) ranked
      WHERE rn <= ${args.perType}`

    const pools = new Map<string, string[]>()
    for (const row of sampled) {
      const key = `${row.type}:${row.trigger_mode ? 'trigger' : 'action'}`
      pools.set(key, [...(pools.get(key) ?? []), row.workflow_id])
    }
    const workflowIds = stratify(pools, args.limit)
    logger.info('Sampled workflows', { strata: pools.size, workflows: workflowIds.length })

    let written = 0
    for (const [index, workflowId] of workflowIds.entries()) {
      try {
        const [row] = await sql<Array<{ variables: unknown }>>`
          SELECT variables FROM workflow WHERE id = ${workflowId}`
        const state = await exportWorkflow(sql, workflowId, row?.variables)
        const file = path.join(args.out, `${String(index).padStart(5, '0')}.json`)
        writeFileSync(
          file,
          `${JSON.stringify({ version: '1.0', exportedAt: new Date().toISOString(), state }, null, 2)}\n`
        )
        written += 1
      } catch (error) {
        logger.error('Workflow export failed', { workflowId, error: getErrorMessage(error) })
        process.exitCode = 1
      }
    }
    logger.info('Redacted export complete', { written, out: args.out })
  } finally {
    await sql.end()
  }
}

if (import.meta.main) {
  main().catch((error) => {
    logger.error('Redacted export aborted', { error: getErrorMessage(error) })
    process.exitCode = 1
  })
}
