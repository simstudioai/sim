import { isDeepStrictEqual } from 'node:util'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { getBlock } from '@/blocks/index'
import { isMcpTool } from '@/executor/constants'
import type { BlockHandler, BlockNodeMetadata, ExecutionContext } from '@/executor/types'
import { readStatusCode } from '@/executor/utils/errors'
import { prepareResolvedSecretProjectedInputs } from '@/executor/utils/resolved-secret-input-projection'
import type { ResolvedSecretInputPath } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import type { ToolConfig } from '@/tools/types'
import { getTool } from '@/tools/utils'

const logger = createLogger('GenericBlockHandler')

interface BlockBoundaryPaths {
  paths: ResolvedSecretInputPath[]
  requiredProjectionRoots: Set<string>
}

function selectBlockBoundaryPaths(
  tool: ToolConfig,
  params: Record<string, unknown>
): BlockBoundaryPaths | undefined {
  try {
    const paths: ResolvedSecretInputPath[] = []
    const requiredProjectionRoots = new Set<string>()
    const modelInput = tool.request.modelInput
    if (modelInput?.mode === 'project') {
      const selected = modelInput.select(params)
      if (!isPlainRecord(selected)) return undefined
      for (const key of Object.keys(selected)) {
        requiredProjectionRoots.add(key)
        paths.push([key])
      }
      const privateInputPaths = modelInput.privateInputPaths?.(params) ?? []
      paths.push(...privateInputPaths)
      for (const path of privateInputPaths) {
        if (path[0]) requiredProjectionRoots.add(path[0])
      }
    } else if (modelInput?.mode === 'private-provenance') {
      const privateInputPaths = modelInput.inputPaths(params)
      paths.push(...privateInputPaths)
      for (const path of privateInputPaths) {
        if (path[0]) requiredProjectionRoots.add(path[0])
      }
    }
    /**
     * Tracked, but never required to project.
     *
     * A `secretProvenance` selection is the opposite mechanism to a projected model input: the
     * value travels to an internal API unchanged, with its provenance alongside it in the private
     * bundle, precisely so nothing has to be substituted. `table_insert_row` posts row data to the
     * table API and declares no `modelInput` at all — there is no model egress on that path.
     *
     * Requiring those roots anyway made a projection failure fatal for tools that have no way to
     * project: `createStructuredModelProjection` rescues only a `mode: 'project'` tool with an
     * `applyProjected`, so for the twenty-odd `secretProvenance`-only tools it returns undefined on
     * its first check. The Table block's `params` runs `parseJSON` on the projected `data` string,
     * which throws once a placeholder stands where the JSON was, and the whole run's registry
     * latched — costing provenance for every later boundary, including the table write itself.
     *
     * A root is required to project when a model will see it, which is what `modelInput` declares.
     */
    for (const selection of tool.request.secretProvenance?.request?.(params) ?? []) {
      paths.push(...selection.inputPaths)
    }

    const uniquePaths = new Map<string, ResolvedSecretInputPath>()
    for (const path of paths) {
      if (path.length > 0) uniquePaths.set(JSON.stringify(path), path)
    }
    return { paths: [...uniquePaths.values()], requiredProjectionRoots }
  } catch {
    return undefined
  }
}

function canonicalPlaceholder(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^\{\{([A-Za-z0-9_]+)\}\}$/.exec(value.trim())
  return match ? value.trim() : undefined
}

function isFileBoundaryPath(tool: ToolConfig, path: ResolvedSecretInputPath): boolean {
  return Boolean(path[0] && tool.params[path[0]]?.type === 'file')
}

function projectScalarLeaves(
  value: unknown,
  placeholder: string
): { value: unknown; projectedLeaves: number } | undefined {
  if (value === null || typeof value !== 'object') {
    return { value: placeholder, projectedLeaves: 1 }
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) return undefined

  const root: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {}
  const pending: Array<{
    source: unknown[] | Record<string, unknown>
    target: unknown[] | Record<string, unknown>
  }> = [{ source: value as unknown[] | Record<string, unknown>, target: root }]
  const visited = new WeakSet<object>()
  let projectedLeaves = 0
  while (pending.length > 0) {
    const { source, target } = pending.pop()!
    if (visited.has(source)) return undefined
    visited.add(source)
    for (const [key, child] of Object.entries(source)) {
      if (child !== null && typeof child === 'object') {
        if (!Array.isArray(child) && !isPlainRecord(child)) return undefined
        const projectedChild: unknown[] | Record<string, unknown> = Array.isArray(child) ? [] : {}
        ;(target as Record<string, unknown>)[key] = projectedChild
        pending.push({
          source: child as unknown[] | Record<string, unknown>,
          target: projectedChild,
        })
      } else {
        ;(target as Record<string, unknown>)[key] = placeholder
        projectedLeaves += 1
      }
    }
  }
  return { value: root, projectedLeaves }
}

function createStructuredModelProjection(
  tool: ToolConfig,
  finalInputs: Record<string, unknown>,
  sourcePath: ResolvedSecretInputPath,
  projectedSourceValue: unknown
): Record<string, unknown> | undefined {
  const modelInput = tool.request.modelInput
  const sourceKey = sourcePath.length === 1 ? sourcePath[0] : undefined
  const placeholder = canonicalPlaceholder(projectedSourceValue)
  if (modelInput?.mode !== 'project' || !modelInput.applyProjected || !sourceKey || !placeholder) {
    return undefined
  }

  try {
    const selected = modelInput.select(finalInputs)
    if (!isPlainRecord(selected) || !Object.hasOwn(selected, sourceKey)) return undefined
    const projectedValue = projectScalarLeaves(selected[sourceKey], placeholder)
    if (!projectedValue || projectedValue.projectedLeaves === 0) return undefined
    const projectedSelection = { ...selected, [sourceKey]: projectedValue.value }
    const selectedParams = Object.fromEntries(
      Object.keys(selected).map((key) => [key, finalInputs[key]])
    )
    const patch = modelInput.applyProjected(structuredClone(selectedParams), projectedSelection)
    if (!isPlainRecord(patch)) return undefined
    const projectedInputs = { ...finalInputs, ...patch }
    if (!isDeepStrictEqual(modelInput.select(projectedInputs), projectedSelection)) return undefined
    return projectedInputs
  } catch {
    return undefined
  }
}

export class GenericBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return true
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>,
    nodeMetadata?: BlockNodeMetadata
  ): Promise<any> {
    const isMcp = block.config.tool ? isMcpTool(block.config.tool) : false
    let tool = null

    if (!isMcp) {
      tool = getTool(block.config.tool)
      if (!tool) {
        throw new Error(`Tool not found: ${block.config.tool}`)
      }
    }

    let finalInputs = { ...inputs }

    const blockType = block.metadata?.id
    if (blockType) {
      const blockConfig = getBlock(blockType)
      const registry = ctx.resolvedSecretTraceRegistry

      if (blockConfig?.tools?.config?.params) {
        const transformedParams = blockConfig.tools.config.params(inputs)
        finalInputs = { ...inputs, ...transformedParams }
      }

      if (blockConfig?.inputs) {
        for (const [key, inputSchema] of Object.entries(blockConfig.inputs)) {
          const value = finalInputs[key]
          if (typeof value === 'string' && value.trim().length > 0) {
            const inputType = typeof inputSchema === 'object' ? inputSchema.type : inputSchema
            if (inputType === 'json' || inputType === 'array') {
              try {
                finalInputs[key] = JSON.parse(value.trim())
              } catch (error) {
                /**
                 * The failure class, not the thrown message. This parses a resolved input, so the
                 * string may be a secret, and V8 quotes the text it rejected back into the
                 * message — `Unexpected token 's', "sk-live-EX"... is not valid JSON`. That
                 * prefix is enough to leak. The field name and its declared type are already in
                 * the message above, and `SyntaxError` is the only class `JSON.parse` throws, so
                 * nothing diagnostic is lost.
                 */
                logger.warn(`Failed to parse ${inputType} field "${key}":`, {
                  error: toError(error).name,
                })
              }
            }
          }
        }
      }

      const boundary = tool ? selectBlockBoundaryPaths(tool, finalInputs) : undefined
      const projectedInputs =
        boundary && boundary.paths.length > 0 && registry?.hasResolvedInputProjections()
          ? registry.projectResolvedInputSelections(inputs)
          : undefined
      if (projectedInputs?.complete === false) {
        registry?.markIncomplete('structural-input-projection-incomplete', {
          detail: { blockType, ...(tool ? { tool: tool.id } : {}) },
        })
      }

      if (projectedInputs?.complete && boundary && tool && registry) {
        for (const projection of projectedInputs.values) {
          const preserveFileDescriptorGrammar =
            isFileBoundaryPath(tool, projection.path) ||
            boundary.paths.some((path) => isFileBoundaryPath(tool, path))
          let projectedFinalInputs = prepareResolvedSecretProjectedInputs(
            projection.value,
            blockConfig?.inputs,
            inputs,
            { preserveFileDescriptorGrammar }
          )
          try {
            if (blockConfig?.tools?.config?.params) {
              projectedFinalInputs = {
                ...projectedFinalInputs,
                ...blockConfig.tools.config.params(projectedFinalInputs),
              }
            }
          } catch (error) {
            const structuredProjection = createStructuredModelProjection(
              tool,
              finalInputs,
              projection.path,
              projection.projectedValue
            )
            if (structuredProjection) {
              registry.recordTransformedInputProjection(finalInputs, structuredProjection, {
                targetPaths: boundary.paths,
              })
              continue
            }
            if (boundary.requiredProjectionRoots.has(projection.path[0])) {
              /**
               * `config.params` threw on the projected inputs — the copy where a secret has been
               * replaced by its placeholder — and no structured projection could recover it. The
               * reason alone said only that this happened somewhere, which is not enough to find
               * the block. The failure class rather than the thrown message, because a coercion
               * that rejects a value tends to quote it, and this input may hold a secret.
               */
              registry.markIncomplete('structural-input-root-unprojected', {
                detail: {
                  blockType,
                  tool: tool.id,
                  inputPath: projection.path.join('.'),
                  failure: toError(error).name,
                },
              })
            }
            continue
          }

          if (blockConfig?.inputs) {
            projectedFinalInputs = prepareResolvedSecretProjectedInputs(
              projectedFinalInputs,
              blockConfig.inputs,
              finalInputs,
              { preserveFileDescriptorGrammar }
            )
            for (const [key, inputSchema] of Object.entries(blockConfig.inputs)) {
              const value = projectedFinalInputs[key]
              if (typeof value !== 'string' || value.trim().length === 0) continue
              const inputType = typeof inputSchema === 'object' ? inputSchema.type : inputSchema
              if (inputType !== 'json' && inputType !== 'array') continue
              try {
                projectedFinalInputs[key] = JSON.parse(value.trim())
              } catch {}
            }
          }

          registry.recordTransformedInputProjection(finalInputs, projectedFinalInputs, {
            targetPaths: boundary.paths,
          })
        }
      }
    }

    try {
      const result = await executeTool(
        block.config.tool,
        {
          ...finalInputs,
          _context: {
            workflowId: ctx.workflowId,
            workspaceId: ctx.workspaceId,
            executionId: ctx.executionId,
            userId: ctx.userId,
            isDeployedContext: ctx.isDeployedContext,
            enforceCredentialAccess: ctx.enforceCredentialAccess,
            blockId: block.id,
            /*
             * The identity a `keyed` tool derives its provider idempotency token
             * from. `executionOrder` is assigned before the block executor's
             * retry wrapper, so it is identical across the transport loop, the
             * hosted-key loop and a block-level retry — and it differs per loop
             * iteration and per parallel branch, so five iterations paying five
             * invoices derive five distinct tokens rather than collapsing into
             * one the provider would dedupe down to a single payment.
             */
            ...(nodeMetadata?.executionOrder !== undefined
              ? { invocationId: String(nodeMetadata.executionOrder) }
              : {}),
          },
        },
        { executionContext: ctx }
      )

      if (!result.success) {
        const errorDetails = []
        if (result.error) errorDetails.push(result.error)

        const errorMessage =
          errorDetails.length > 0
            ? errorDetails.join(' - ')
            : `Block execution of ${tool?.name || block.config.tool} failed with no error message`

        const error = new Error(errorMessage)

        Object.assign(error, {
          toolId: block.config.tool,
          toolName: tool?.name || 'Unknown tool',
          blockId: block.id,
          blockName: block.metadata?.name || 'Unnamed Block',
          output: result.output || {},
          timestamp: new Date().toISOString(),
          // `executeTool` flattens a thrown error into a result, so Sim's own
          // status (hosted-key 429/503) would be lost here. Carry it onto the
          // error so `getExecutionErrorStatus` can still reach the API caller.
          ...(typeof result.statusCode === 'number' ? { statusCode: result.statusCode } : {}),
        })

        throw error
      }

      return result.output
    } catch (error: any) {
      if (!error.message || error.message === 'undefined (undefined)') {
        let errorMessage = `Block execution of ${tool?.name || block.config.tool} failed`

        if (block.metadata?.name) {
          errorMessage += `: ${block.metadata.name}`
        }

        const statusCode = readStatusCode(error)
        if (statusCode !== undefined) {
          errorMessage += ` (Status: ${statusCode})`
        }

        error.message = errorMessage
      }

      if (typeof error === 'object' && error !== null) {
        if (!error.toolId) error.toolId = block.config.tool
        if (!error.blockName) error.blockName = block.metadata?.name || 'Unnamed Block'
      }

      throw error
    }
  }
}
