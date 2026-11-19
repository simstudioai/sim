/**
 * Custom tools as workspace source: `tools/<key>.ts` declares a tool's title and schema, and
 * `tools/<key>.js` holds its code. Every read and write goes through the custom tool use cases, so
 * their authorization, title rules and audit apply. A declared schema is checked with
 * `assertValidCustomToolDeclaration` at plan time when it is created or changed, as the use case
 * checks a schema it is sent; an unchanged stored schema is never re-judged by a newer rule.
 *
 * Code holding what looks like a literal credential prints as `code: stored()`, fingerprinted by a
 * keyed hash of the code, as an MCP server's credential header is: the code never leaves the
 * server, and neither does a plain hash a short secret could be guessed from. `stored()` resolves
 * against the tool bound to the key (or adopted by title) and is never written.
 */

import { hmacSha256Hex } from '@sim/security/hmac'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { holdsSecret, type Json } from '@sim/workflow-code'
import { resourceAddress } from '@sim/workspace-code'
import {
  isStoredToolCode,
  type ToolCode,
  toolCodec,
  toolDeclarationPath,
  toolLiteralSecret,
} from '@sim/workspace-code/kinds/tools'
import type { CursorKey } from '@/lib/api/list-query'
import { env } from '@/lib/core/config/env'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createWorkspaceCustomToolUseCase,
  deleteWorkspaceCustomToolUseCase,
  getWorkspaceCustomToolUseCase,
  listWorkspaceCustomToolsUseCase,
  updateWorkspaceCustomToolUseCase,
} from '@/lib/custom-tools/application/use-cases'
import { assertValidCustomToolDeclaration } from '@/lib/custom-tools/schema'
import { kindFinding, serverGoneFinding } from '@/lib/workspace-source/application/findings'
import { bindStored, listUpTo } from '@/lib/workspace-source/application/keys'
import {
  applyNamed,
  authorizeNamed,
  type NamedKind,
  planNamed,
  planNamedUndeclared,
  readRecord,
  storedFingerprint,
  writtenFields,
} from '@/lib/workspace-source/application/kinds/named'
import { holdsIn } from '@/lib/workspace-source/application/three-way'
import type {
  KindAdapter,
  PlannedChange,
  SourceContext,
} from '@/lib/workspace-source/application/types'

/** A stored custom tool as source reads it. */
interface StoredTool {
  id: string
  title: string
  schema: unknown
  code: string
}

type ToolChange = PlannedChange<'custom-tool'>

const PAGE_SIZE = 200

/** A tool's code as source holds it: the keyed hash of code holding a literal credential, else the code. */
function codeOf(tool: Pick<StoredTool, 'id' | 'code'>): ToolCode {
  if (!holdsSecret(undefined, tool.code)) return tool.code
  return {
    stored: hmacSha256Hex(
      `custom-tool-code\u0000${tool.id}\u0000${tool.code}`,
      env.BETTER_AUTH_SECRET
    ),
  }
}

/** The code a write stores: never `stored()`, which a plan resolves to the stored code. */
function codeToWrite(code: ToolCode): string {
  if (isStoredToolCode(code)) {
    throw new OrchestrationError(
      'validation',
      'stored() keeps the stored code; it is never written.'
    )
  }
  return code
}

const tools: NamedKind<'custom-tool', StoredTool> = {
  kind: 'custom-tool',
  codec: toolCodec,
  nameOf: (decl) => decl.title,
  /** A schema that is not an object (a legacy row) reads as `{}`; a get leaves such a tool out. */
  declOf: (state) => ({
    title: state.title,
    schema: isSchemaObject(state.schema) ? state.schema : {},
    code: codeOf(state),
  }),
  resolve: (decl, state) => (isStoredToolCode(decl.code) ? { ...decl, code: codeOf(state) } : decl),
}

function isSchemaObject(value: unknown): value is Record<string, Json> {
  return isRecordLike(value)
}

async function getTool(ctx: SourceContext, toolId: string): Promise<StoredTool> {
  const { tool } = await getWorkspaceCustomToolUseCase.execute({
    principal: ctx.principal,
    input: { workspaceId: ctx.workspace.workspaceId, toolId },
  })
  return tool
}

export const toolAdapter: KindAdapter<'custom-tool', StoredTool> = {
  codec: toolCodec,

  async load(ctx, { allocate }) {
    const tools = await listUpTo(async (cursorKeys: CursorKey[] | undefined) => {
      const page = await listWorkspaceCustomToolsUseCase.execute({
        principal: ctx.principal,
        input: {
          workspaceId: ctx.workspace.workspaceId,
          sortBy: 'createdAt',
          sortOrder: 'asc',
          limit: PAGE_SIZE,
          ...(cursorKeys ? { cursorKeys } : {}),
        },
      })
      return { items: page.tools, next: page.nextCursorKeys }
    })
    const records = tools.map((tool) => ({ id: tool.id, name: tool.title, state: tool }))
    return bindStored(ctx, 'custom-tool', records, { allocate })
  },

  async plan(desired, stored, ctx) {
    const claimed = new Map<string, string>()
    const changes: ToolChange[] = []
    for (const [key, declared] of desired) {
      // `stored()` keeps the code of the tool the key is bound to, else the one adopted by title.
      const target = isStoredToolCode(declared.code)
        ? (stored.bound.get(key) ?? stored.unbound.find((record) => record.name === declared.title))
        : undefined
      const decl = target ? (tools.resolve?.(declared, target.state) ?? declared) : declared
      // A tool the base records that the server deleted since: its `stored()` code has nothing to
      // keep, and the declaration cannot be compared with the base, so it stays deleted.
      const recorded = ctx.base?.resources[resourceAddress('custom-tool', key)]
      if (isStoredToolCode(declared.code) && !target && recorded && !holdsIn(stored)(recorded.id)) {
        changes.push({
          kind: 'custom-tool',
          key,
          action: 'noop',
          decl: declared,
          diagnostics: [serverGoneFinding('custom-tool', key, false)],
        })
        continue
      }
      const change = planNamed(
        tools,
        key,
        decl,
        stored,
        desired,
        ctx,
        toolDeclarationPath(key),
        claimed
      )
      try {
        if (writtenFields(change).includes('schema')) assertValidCustomToolDeclaration(decl.schema)
      } catch (error) {
        if (!(error instanceof OrchestrationError)) throw error
        change.diagnostics.push(
          kindFinding('custom-tool', key, 'E_TOOL_SCHEMA', getErrorMessage(error), {
            file: toolDeclarationPath(key),
          })
        )
      }
      // A renamed key or a taken title already says which tool the declaration meant.
      const refusedForName = change.diagnostics.some(
        (finding) => finding.code === 'E_KEY_RENAMED' || finding.code === 'E_NAME_TAKEN'
      )
      if (isStoredToolCode(declared.code) && !target && !refusedForName) {
        change.diagnostics.push(
          kindFinding(
            'custom-tool',
            key,
            'E_TOOL_STORED_MISSING',
            'The code is stored(), which keeps the code of the stored tool, but no tool is stored under this key or title.',
            {
              file: toolDeclarationPath(key),
              hint: `Write the code in tools/${key}.js, or get the directory from the workspace that holds the tool.`,
            }
          )
        )
      }
      changes.push(change)
    }
    return [...changes, ...planNamedUndeclared(tools, desired, stored, ctx, changes)]
  },

  async authorize(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    await authorizeNamed(change, {
      create: (decl) =>
        createWorkspaceCustomToolUseCase.authorize({
          principal,
          input: {
            workspaceId,
            title: decl.title,
            schema: decl.schema,
            code: codeToWrite(decl.code),
          },
        }),
      update: (toolId) =>
        updateWorkspaceCustomToolUseCase.authorize({ principal, input: { workspaceId, toolId } }),
      remove: (toolId) =>
        deleteWorkspaceCustomToolUseCase.authorize({ principal, input: { workspaceId, toolId } }),
    })
  },

  async storedFingerprintNow(change, ctx) {
    if (!change.storedId) throw new Error('A custom tool check needs the stored id')
    return storedFingerprint(tools, await getTool(ctx, change.storedId))
  },

  async apply(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    return applyNamed(tools, change, {
      async create(decl) {
        const { tool } = await createWorkspaceCustomToolUseCase.execute({
          principal,
          input: {
            workspaceId,
            title: decl.title,
            schema: decl.schema,
            code: codeToWrite(decl.code),
            source: 'api',
          },
        })
        return { id: tool.id, state: tool }
      },
      get: (toolId) => getTool(ctx, toolId),
      async update(toolId, { code, ...fields }) {
        const { tool } = await updateWorkspaceCustomToolUseCase.execute({
          principal,
          input: {
            workspaceId,
            toolId,
            ...fields,
            ...(code === undefined ? {} : { code: codeToWrite(code) }),
            source: 'api',
          },
        })
        return tool
      },
      async remove(toolId) {
        await deleteWorkspaceCustomToolUseCase.execute({
          principal,
          input: { workspaceId, toolId, source: 'api' },
        })
      },
    })
  },

  async read(stored) {
    if (!isSchemaObject(stored.state.schema)) {
      throw new OrchestrationError('validation', 'The stored schema is not an object.')
    }
    const read = readRecord(tools, stored)
    if (!isStoredToolCode(tools.declOf(stored.state).code)) return read
    const { message, hint } = toolLiteralSecret(true)
    return {
      ...read,
      diagnostics: [
        kindFinding('custom-tool', stored.key, 'W_TOOL_LITERAL_SECRET', message, {
          file: toolDeclarationPath(stored.key),
          hint,
        }),
      ],
    }
  },
}
