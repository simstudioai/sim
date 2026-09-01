import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import {
  BILLING_ATTRIBUTION_HEADER,
  serializeBillingAttributionHeader,
} from '@/lib/billing/core/billing-attribution'
import { normalizeSecretMountPolicy } from '@/lib/copilot/secret-mount-policy'
import { env } from '@/lib/core/config/env'
import {
  projectModelSchemaAnnotations,
  projectResolvedModelInput,
  selectModelSchemaInputPaths,
} from '@/lib/execution/model-input-provenance'
import { readUserFileContent } from '@/lib/execution/payloads/materialization.server'
import {
  inspectPrivateToolMetadataEnvelope,
  inspectPrivateToolMetadataResponseCapability,
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import {
  areModelSafeWorkspaceFileKeys,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  createFileContentFromBase64,
  type MessageContent,
  processSingleFileToUserFile,
  type RawFileInput,
} from '@/lib/uploads/utils/file-utils'
import { selectModelBoundFileInputPaths } from '@/lib/uploads/utils/model-input'
import type { BlockOutput } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import { BlockType } from '@/executor/constants'
import type {
  BlockHandler,
  ExecutionContext,
  NormalizedBlockOutput,
  StreamingExecution,
} from '@/executor/types'
import { buildAPIUrl, buildAuthHeaders, extractAPIErrorMessage } from '@/executor/utils/http'
import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import type {
  ResolvedSecretInputPath,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('MothershipBlockHandler')

const MOTHERSHIP_INPUT_REFUSAL = 'Mothership input could not be safely projected'
const MOTHERSHIP_SKILL_SELECTOR_REFUSAL =
  'Mothership skill selector could not be safely projected for display'
const MAX_MOTHERSHIP_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MOTHERSHIP_EXECUTE_STREAM_HEADER = 'X-Mothership-Execute-Stream'
const MOTHERSHIP_EXECUTE_STREAM_VALUE = 'ndjson'

type MothershipFileAttachment = MessageContent & {
  filename?: string
}

interface MothershipMcpToolSelection {
  type: 'mcp'
  usageControl?: 'auto' | 'force'
  schema?: Record<string, unknown>
  params: {
    serverId: string
    toolName: string
    serverName?: string
  }
}

interface MothershipSkillContext {
  kind: 'skill'
  skillId: string
  label: string
}

interface IndexedMothershipMcpToolSelection {
  inputIndex: number
  selection: MothershipMcpToolSelection
}

interface IndexedMothershipSkillContext {
  inputIndex: number
  context: MothershipSkillContext
  hasExplicitLabel: boolean
}

type MothershipExecuteResult = {
  content?: string
  model?: string
  conversationId?: string
  tokens?: Record<string, unknown>
  toolCalls?: Array<Record<string, unknown>>
  cost?: unknown
} & Partial<Record<typeof RESOLVED_SECRET_PROVENANCE_FIELD, unknown>>

type MothershipExecuteStreamEvent =
  | { type: 'heartbeat'; timestamp?: string }
  | { type: 'chunk'; content?: string }
  | { type: 'final'; data: MothershipExecuteResult }
  | ({ type: 'error'; error?: string } & Partial<
      Record<typeof RESOLVED_SECRET_PROVENANCE_FIELD, unknown>
    >)

function selectIndexedMothershipMcpTools(tools: unknown): IndexedMothershipMcpToolSelection[] {
  if (!Array.isArray(tools)) return []

  return tools.flatMap((candidate, inputIndex) => {
    if (!isPlainRecord(candidate) || candidate.type !== 'mcp') return []
    if (candidate.usageControl === 'none' || !isPlainRecord(candidate.params)) return []

    const { serverId, toolName } = candidate.params
    if (typeof serverId !== 'string' || !serverId || typeof toolName !== 'string' || !toolName) {
      return []
    }

    const serverName =
      typeof candidate.params.serverName === 'string' ? candidate.params.serverName : undefined
    const schema = isPlainRecord(candidate.schema) ? candidate.schema : undefined

    const usageControl =
      candidate.usageControl === 'auto' || candidate.usageControl === 'force'
        ? candidate.usageControl
        : undefined
    const selection: MothershipMcpToolSelection = {
      type: 'mcp',
      ...(usageControl ? { usageControl } : {}),
      ...(schema ? { schema } : {}),
      params: {
        serverId,
        toolName,
        ...(serverName !== undefined ? { serverName } : {}),
      },
    }
    return [{ inputIndex, selection }]
  })
}

function selectMothershipMcpTools(tools: unknown): MothershipMcpToolSelection[] {
  return selectIndexedMothershipMcpTools(tools).map(({ selection }) => selection)
}

function selectIndexedMothershipSkillContexts(
  skills: unknown,
  privateSelectorIndexes: ReadonlySet<number> = new Set()
): IndexedMothershipSkillContext[] {
  if (!Array.isArray(skills)) return []

  return skills.flatMap((candidate, inputIndex) => {
    if (!isPlainRecord(candidate) || typeof candidate.skillId !== 'string' || !candidate.skillId) {
      return []
    }
    const explicitLabel = typeof candidate.name === 'string' ? candidate.name : undefined
    const hasExplicitLabel = explicitLabel !== undefined
    const label =
      explicitLabel ??
      (privateSelectorIndexes.has(inputIndex) ? `Skill ${inputIndex + 1}` : candidate.skillId)
    return [
      {
        inputIndex,
        hasExplicitLabel,
        context: {
          kind: 'skill' as const,
          skillId: candidate.skillId,
          label,
        },
      },
    ]
  })
}

function selectMothershipSkillContexts(
  skills: unknown,
  privateSelectorIndexes: ReadonlySet<number>
): MothershipSkillContext[] {
  return selectIndexedMothershipSkillContexts(skills, privateSelectorIndexes).map(
    ({ context }) => context
  )
}

function selectPrivateMothershipSkillSelectors(
  registry: ResolvedSecretTraceRegistry | undefined,
  skills: unknown
): {
  inputIndexes: ReadonlySet<number>
  inputPaths: readonly ResolvedSecretInputPath[]
} {
  if (!registry) return { inputIndexes: new Set(), inputPaths: [] }

  const inputIndexes = new Set<number>()
  const inputPaths: ResolvedSecretInputPath[] = []
  for (const { inputIndex } of selectIndexedMothershipSkillContexts(skills)) {
    const inputPath = ['skills', String(inputIndex), 'skillId'] as const
    const provenance = registry.exportCommittedProvenanceForInputPaths([inputPath])
    if (!provenance.complete) {
      throw new Error('Mothership skill selector provenance is incomplete')
    }
    if (provenance.entries.length === 0) continue
    inputIndexes.add(inputIndex)
    inputPaths.push(inputPath)
  }
  return { inputIndexes, inputPaths }
}

function forkMothershipRegistryWithoutPrivateSkillSelectors(
  registry: ResolvedSecretTraceRegistry,
  inputs: Record<string, unknown>,
  privateSelectorIndexes: ReadonlySet<number>
): ResolvedSecretTraceRegistry {
  const retainedInputPaths: ResolvedSecretInputPath[] = []
  for (const [key, value] of Object.entries(inputs)) {
    if (key !== 'skills') {
      retainedInputPaths.push([key])
      continue
    }
    if (!Array.isArray(value)) continue
    for (const [inputIndex, candidate] of value.entries()) {
      if (!isPlainRecord(candidate)) continue
      for (const candidateKey of Object.keys(candidate)) {
        if (candidateKey === 'skillId' && privateSelectorIndexes.has(inputIndex)) continue
        retainedInputPaths.push(['skills', String(inputIndex), candidateKey])
      }
    }
  }
  return registry.forkForInputPaths(retainedInputPaths)
}

function projectPrivateMothershipSkillSelectorsForDisplay(
  registry: ResolvedSecretTraceRegistry,
  skills: unknown,
  privateSelectorIndexes: ReadonlySet<number>,
  privateSelectorInputPaths: readonly ResolvedSecretInputPath[]
): unknown {
  if (!Array.isArray(skills) || privateSelectorIndexes.size === 0) return skills
  const selectorRegistry = registry.forkForInputPaths(privateSelectorInputPaths)
  const projection = selectorRegistry.projectResolvedInputSelection({ skills })
  if (!projection.complete || !Array.isArray(projection.value.skills)) {
    refuseResolvedSecretProjection({
      site: 'mothership.skillSelectorDisplay',
      message: MOTHERSHIP_SKILL_SELECTOR_REFUSAL,
      registry: selectorRegistry,
      inputPath: 'skills',
    })
  }
  for (const inputIndex of privateSelectorIndexes) {
    const source = skills[inputIndex]
    const projected = projection.value.skills[inputIndex]
    if (
      !isPlainRecord(source) ||
      !isPlainRecord(projected) ||
      typeof source.skillId !== 'string' ||
      typeof projected.skillId !== 'string'
    ) {
      refuseResolvedSecretProjection({
        site: 'mothership.skillSelectorDisplayEntry',
        message: MOTHERSHIP_SKILL_SELECTOR_REFUSAL,
        registry: selectorRegistry,
        inputPath: 'skills.skillId',
      })
    }
  }
  return projection.value.skills
}

function selectMothershipMetadataModelInputPaths(
  tools: unknown,
  skills: unknown
): {
  modelInputPaths: ResolvedSecretInputPath[]
  structuralInputPaths: ResolvedSecretInputPath[]
} {
  const modelInputPaths: ResolvedSecretInputPath[] = []
  const structuralInputPaths: ResolvedSecretInputPath[] = []

  for (const { inputIndex, selection } of selectIndexedMothershipMcpTools(tools)) {
    const root = ['tools', String(inputIndex)] as const
    structuralInputPaths.push([...root, 'params', 'serverId'], [...root, 'params', 'toolName'])
    if (selection.schema) {
      const schemaPaths = selectModelSchemaInputPaths(selection.schema, [...root, 'schema'])
      modelInputPaths.push(...schemaPaths.annotationInputPaths)
      structuralInputPaths.push(...schemaPaths.semanticInputPaths)
    }
    if (selection.params.serverName !== undefined) {
      modelInputPaths.push([...root, 'params', 'serverName'])
    }
  }

  for (const { inputIndex, hasExplicitLabel } of selectIndexedMothershipSkillContexts(skills)) {
    const root = ['skills', String(inputIndex)] as const
    if (hasExplicitLabel) modelInputPaths.push([...root, 'name'])
  }

  return { modelInputPaths, structuralInputPaths }
}

function assertMothershipToolSchemaProjectionsAreSafe(
  registry: ResolvedSecretTraceRegistry,
  tools: unknown
): void {
  if (!Array.isArray(tools)) return
  const projection = registry.projectResolvedInputSelection({ tools })
  if (!projection.complete || !Array.isArray(projection.value.tools)) {
    refuseResolvedSecretProjection({
      site: 'mothership.toolSchemaProjection',
      message: MOTHERSHIP_INPUT_REFUSAL,
      registry,
      inputPath: 'tools',
    })
  }

  for (const { inputIndex, selection } of selectIndexedMothershipMcpTools(tools)) {
    if (!selection.schema) continue
    const projectedCandidate = projection.value.tools[inputIndex]
    if (!isPlainRecord(projectedCandidate)) {
      refuseResolvedSecretProjection({
        site: 'mothership.toolSchemaProjectedEntry',
        message: MOTHERSHIP_INPUT_REFUSAL,
        registry,
        inputPath: 'tools.schema',
      })
    }
    const projectedSchema = projectedCandidate.schema ?? selection.schema
    const schemaProjection = projectModelSchemaAnnotations(selection.schema, projectedSchema)
    if (!schemaProjection.safe) {
      refuseResolvedSecretProjection({
        site: 'mothership.toolSchemaAnnotations',
        message: MOTHERSHIP_INPUT_REFUSAL,
        registry,
        inputPath: 'tools.schema',
      })
    }
  }
}

function assertMothershipStructuralInputsDoNotResolveSecrets(
  registry: ResolvedSecretTraceRegistry,
  inputPaths: readonly ResolvedSecretInputPath[]
): void {
  const provenance = registry.exportCommittedProvenanceForInputPaths(inputPaths)
  if (!provenance.complete) {
    refuseResolvedSecretProjection({
      site: 'mothership.structuralInputProvenance',
      message: MOTHERSHIP_INPUT_REFUSAL,
      registry,
    })
  }
  if (provenance.entries.length > 0) {
    throw new Error('Mothership structural model inputs cannot contain secret references')
  }
}

async function consumeMothershipProvenance(
  payload: Partial<Record<typeof RESOLVED_SECRET_PROVENANCE_FIELD, unknown>>,
  response: Response,
  registry?: ResolvedSecretTraceRegistry
): Promise<boolean> {
  const inspection = inspectPrivateToolMetadataEnvelope(
    response.headers,
    payload,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1
  )
  const provenance = payload[RESOLVED_SECRET_PROVENANCE_FIELD]
  payload[RESOLVED_SECRET_PROVENANCE_FIELD] = undefined
  if (inspection.status === 'unsupported') {
    return false
  }
  if (inspection.status === 'invalid') {
    registry?.markIncomplete('mothership-provenance-invalid')
    throw new Error('Mothership response provenance metadata is invalid')
  }

  if (!registry) return false

  const imported = await registry.importProvenanceForValue(provenance, payload, {
    trusted: true,
    origin: 'mothership.payloadCrossing',
  })
  if (!imported) throw new Error('Mothership response provenance metadata is invalid')
  return true
}

function inspectMothershipResponseCapability(
  response: Response,
  registry: ResolvedSecretTraceRegistry | undefined
): boolean {
  const capability = inspectPrivateToolMetadataResponseCapability(
    response.headers,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1
  )
  if (capability.status === 'supported') return true
  if (capability.status === 'unsupported') {
    return false
  }

  registry?.markIncomplete('mothership-provenance-invalid')
  throw new Error('Mothership response provenance metadata is invalid')
}

function parseMothershipExecuteStreamLine(line: string): MothershipExecuteStreamEvent | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined

  try {
    return JSON.parse(trimmed) as MothershipExecuteStreamEvent
  } catch {
    throw new Error('Sim execution stream returned malformed data')
  }
}

function formatMothershipBlockOutput(
  result: MothershipExecuteResult,
  fallbackChatId: string
): NormalizedBlockOutput {
  const formattedList = (result.toolCalls || []).map((tc: Record<string, unknown>) => ({
    name: typeof tc.name === 'string' ? tc.name : String(tc.name ?? ''),
    ...(typeof tc.status === 'string' ? { status: tc.status } : {}),
    arguments: (tc.arguments || tc.params || tc.input || {}) as Record<string, unknown>,
    result: (tc.result ?? tc.output) as any,
    error: typeof tc.error === 'string' ? tc.error : undefined,
    duration: typeof tc.durationMs === 'number' ? tc.durationMs : 0,
  }))
  const toolCalls: NormalizedBlockOutput['toolCalls'] = {
    list: formattedList,
    count: formattedList.length,
  }

  return {
    content: result.content || '',
    model: result.model || 'mothership',
    conversationId: result.conversationId || fallbackChatId,
    tokens: (result.tokens || {}) as NormalizedBlockOutput['tokens'],
    toolCalls,
    cost: result.cost as NormalizedBlockOutput['cost'] | undefined,
  }
}

function isContentSelectedForStreaming(ctx: ExecutionContext, block: SerializedBlock): boolean {
  if (!ctx.stream) return false

  return (
    ctx.selectedOutputs?.some((outputId) => {
      if (outputId === block.id) return true
      return outputId === `${block.id}.content` || outputId === `${block.id}_content`
    }) ?? false
  )
}

async function readMothershipExecuteResponse(
  response: Response,
  registry?: ResolvedSecretTraceRegistry
): Promise<MothershipExecuteResult> {
  const expectsProvenance = inspectMothershipResponseCapability(response, registry)
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/x-ndjson')) {
    let result: MothershipExecuteResult
    try {
      result = (await response.json()) as MothershipExecuteResult
    } catch (error) {
      if (expectsProvenance) {
        registry?.markIncomplete('mothership-response-unreadable')
        throw new Error('Mothership response provenance metadata is invalid')
      }
      throw error
    }
    await consumeMothershipProvenance(result, response, registry)
    return result
  }

  if (!response.body) {
    throw new Error('Sim execution stream ended without a response body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: MothershipExecuteResult | undefined
  let receivedTerminalProvenance = false

  const processLine = async (line: string): Promise<void> => {
    const event = parseMothershipExecuteStreamLine(line)
    if (!event) return

    if (event.type === 'heartbeat' || event.type === 'chunk') {
      return
    }

    if (event.type === 'error') {
      receivedTerminalProvenance = await consumeMothershipProvenance(event, response, registry)
      throw new Error(`Sim execution failed: ${event.error || 'Unknown error'}`)
    }

    if (event.type === 'final') {
      await consumeMothershipProvenance(event.data, response, registry)
      finalResult = event.data
      return
    }

    throw new Error('Sim execution stream returned an unknown event')
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        await processLine(line)
      }
    }

    buffer += decoder.decode()
    await processLine(buffer)

    if (!finalResult) {
      throw new Error('Sim execution stream ended without a final result')
    }

    return finalResult
  } finally {
    if (expectsProvenance && !finalResult && !receivedTerminalProvenance) {
      registry?.markIncomplete('mothership-provenance-missing')
    }
    reader.releaseLock()
  }
}

function createMothershipStreamingExecution(
  response: Response,
  fallbackChatId: string,
  blockId: string,
  options: {
    onCancel?: (reason?: unknown) => void
    onDone?: () => void
    registry?: ResolvedSecretTraceRegistry
  } = {}
): StreamingExecution {
  const expectsProvenance = inspectMothershipResponseCapability(response, options.registry)
  if (!response.body) {
    throw new Error('Sim execution stream ended without a response body')
  }

  const output = formatMothershipBlockOutput({}, fallbackChatId)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let cancelled = false
  let cleanedUp = false
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    options.onDone?.()
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      reader = response.body!.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let buffer = ''
      let sawFinal = false
      let receivedTerminalProvenance = false

      const processLine = async (line: string): Promise<void> => {
        const event = parseMothershipExecuteStreamLine(line)
        if (!event) return

        if (event.type === 'heartbeat') {
          return
        }

        if (event.type === 'chunk') {
          if (event.content) {
            controller.enqueue(encoder.encode(event.content))
          }
          return
        }

        if (event.type === 'error') {
          receivedTerminalProvenance = await consumeMothershipProvenance(
            event,
            response,
            options.registry
          )
          throw new Error(`Sim execution failed: ${event.error || 'Unknown error'}`)
        }

        if (event.type === 'final') {
          await consumeMothershipProvenance(event.data, response, options.registry)
          sawFinal = true
          Object.assign(output, formatMothershipBlockOutput(event.data, fallbackChatId))
          return
        }

        throw new Error('Sim execution stream returned an unknown event')
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (cancelled) return
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            await processLine(line)
          }
        }

        buffer += decoder.decode()
        await processLine(buffer)

        if (!sawFinal) {
          throw new Error('Sim execution stream ended without a final result')
        }

        if (!cancelled) controller.close()
      } catch (error) {
        if (!cancelled) {
          controller.error(error)
        }
      } finally {
        if (expectsProvenance && !sawFinal && !receivedTerminalProvenance) {
          options.registry?.markIncomplete('mothership-provenance-missing')
        }
        cleanup()
        reader?.releaseLock()
      }
    },
    cancel(reason) {
      cancelled = true
      options.onCancel?.(reason)
      cleanup()
      return reader?.cancel(reason)
    },
  })

  return {
    stream,
    execution: {
      success: true,
      output,
      blockId,
      logs: [],
      metadata: {
        duration: 0,
        startTime: new Date().toISOString(),
      },
      isStreaming: true,
    } as StreamingExecution['execution'] & { blockId: string },
  }
}

async function buildMothershipFileAttachments(
  filesInput: unknown,
  projectedFilesInput: unknown,
  ctx: ExecutionContext,
  requestId: string
): Promise<MothershipFileAttachment[] | undefined> {
  const files = normalizeFileInput(filesInput)
  if (!files || files.length === 0) {
    return undefined
  }

  if (!ctx.userId) {
    throw new Error('Mothership file attachments require an authenticated user.')
  }
  const projectedFiles = normalizeFileInput(projectedFilesInput)
  if (!projectedFiles || projectedFiles.length !== files.length) {
    refuseResolvedSecretProjection({
      site: 'mothership.fileAttachmentArity',
      message: MOTHERSHIP_INPUT_REFUSAL,
      registry: ctx.resolvedSecretTraceRegistry,
      inputPath: 'files',
    })
  }

  const userFiles = files.map((file) =>
    processSingleFileToUserFile(file as RawFileInput, requestId, logger)
  )
  const modelSafe = await areModelSafeWorkspaceFileKeys(
    userFiles.map((file) => file.key).filter((key): key is string => Boolean(key)),
    { workspaceId: ctx.workspaceId, ...(ctx.userId ? { actorUserId: ctx.userId } : {}) }
  )
  if (!modelSafe) throw new Error(MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE)

  const attachments: MothershipFileAttachment[] = []
  for (let fileIndex = 0; fileIndex < userFiles.length; fileIndex++) {
    const userFile = userFiles[fileIndex]
    const rawFile = files[fileIndex]
    const projectedFile = projectedFiles[fileIndex]
    if (
      isPlainRecord(rawFile) &&
      isPlainRecord(projectedFile) &&
      !Object.is(rawFile.base64, projectedFile.base64)
    ) {
      throw new Error('Mothership inline file content cannot contain secret references')
    }
    const base64 = await readUserFileContent(userFile, {
      encoding: 'base64',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      largeValueExecutionIds: ctx.largeValueExecutionIds,
      largeValueKeys: ctx.largeValueKeys,
      fileKeys: ctx.fileKeys,
      allowLargeValueWorkflowScope: ctx.allowLargeValueWorkflowScope,
      requestId,
      logger,
      maxBytes: MAX_MOTHERSHIP_ATTACHMENT_BYTES,
      maxSourceBytes: MAX_MOTHERSHIP_ATTACHMENT_BYTES,
    })

    const content = createFileContentFromBase64(base64, userFile.type)
    if (!content) {
      throw new Error(`File type is not supported for Mothership attachments: ${userFile.name}`)
    }

    const projectedName = isPlainRecord(projectedFile) ? projectedFile.name : undefined
    attachments.push({
      ...content,
      filename: typeof projectedName === 'string' ? projectedName : userFile.name,
    })
  }

  return attachments
}

/**
 * Handler for Mothership blocks that proxy requests to the Mothership AI agent.
 *
 * Unlike the Agent block (which calls LLM providers directly), the Mothership
 * block delegates to the full Mothership infrastructure: main agent, subagents,
 * integration tools, memory, and workspace context.
 */
export class MothershipBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.MOTHERSHIP
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput | StreamingExecution> {
    const sourceRegistry = ctx.resolvedSecretTraceRegistry
    const resultRegistry = sourceRegistry?.forkForInputPaths([])
    ctx.errorResolvedSecretTraceRegistry = resultRegistry
    const requestSkills = inputs.skills
    const privateSkillSelectors = selectPrivateMothershipSkillSelectors(
      sourceRegistry,
      requestSkills
    )
    if (sourceRegistry && privateSkillSelectors.inputPaths.length > 0) {
      inputs.skills = projectPrivateMothershipSkillSelectorsForDisplay(
        sourceRegistry,
        requestSkills,
        privateSkillSelectors.inputIndexes,
        privateSkillSelectors.inputPaths
      )
      ctx.resolvedSecretTraceRegistry = forkMothershipRegistryWithoutPrivateSkillSelectors(
        sourceRegistry,
        inputs,
        privateSkillSelectors.inputIndexes
      )
    }

    // Without the key the mothership rejects every request, so fail with
    // something the workflow author can act on instead of a bare 401.
    if (!env.COPILOT_API_KEY) {
      throw new Error('COPILOT_API_KEY is not configured, so the Sim Chat block cannot run')
    }

    const prompt = inputs.prompt
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt input is required')
    }
    const metadataInputPaths = selectMothershipMetadataModelInputPaths(inputs.tools, requestSkills)
    if (ctx.resolvedSecretTraceRegistry) {
      assertMothershipStructuralInputsDoNotResolveSecrets(
        ctx.resolvedSecretTraceRegistry,
        metadataInputPaths.structuralInputPaths
      )
      assertMothershipToolSchemaProjectionsAreSafe(ctx.resolvedSecretTraceRegistry, inputs.tools)
    }
    const modelInputPaths: ResolvedSecretInputPath[] = [
      ['prompt'],
      ...selectModelBoundFileInputPaths(inputs.files, ['files'], {
        includeInlineBase64: true,
        includeName: true,
        parseSerializedFile: true,
      }),
      ...metadataInputPaths.modelInputPaths,
    ]
    const modelInputProjection = projectResolvedModelInput(
      sourceRegistry,
      { prompt, files: inputs.files, tools: inputs.tools, skills: requestSkills },
      modelInputPaths
    )
    if (!modelInputProjection.complete || typeof modelInputProjection.value.prompt !== 'string') {
      refuseResolvedSecretProjection({
        site: 'mothership.modelInput',
        message: MOTHERSHIP_INPUT_REFUSAL,
        registry: sourceRegistry,
        inputPath: 'prompt,files,tools,skills',
      })
    }
    const messages = [
      {
        role: 'user' as const,
        content: modelInputProjection.value.prompt,
      },
    ]
    const providedConversationId =
      typeof inputs.conversationId === 'string' ? inputs.conversationId.trim() : ''
    const chatId = providedConversationId || generateId()
    const messageId = generateId()
    const requestId = generateId()
    const secretMountPolicy = normalizeSecretMountPolicy({
      secretScope: inputs.secretScope,
      mountedSecrets: inputs.mountedSecrets,
    })
    const mcpTools = selectMothershipMcpTools(modelInputProjection.value.tools)
    const skillContexts = selectMothershipSkillContexts(
      modelInputProjection.value.skills,
      privateSkillSelectors.inputIndexes
    )
    const fileAttachments = await buildMothershipFileAttachments(
      inputs.files,
      modelInputProjection.value.files,
      ctx,
      requestId
    )

    const url = buildAPIUrl('/api/mothership/execute')
    const headers = await buildAuthHeaders(ctx.userId)
    headers.Accept = 'application/x-ndjson'
    headers[MOTHERSHIP_EXECUTE_STREAM_HEADER] = MOTHERSHIP_EXECUTE_STREAM_VALUE
    if (ctx.resolvedSecretTraceRegistry) {
      headers[PRIVATE_TOOL_METADATA_REQUEST_HEADER] = RESOLVED_SECRET_PROVENANCE_METADATA_V1
    }
    if (!ctx.metadata.billingAttribution) {
      throw new Error('Billing attribution is required for Mothership execution')
    }
    headers[BILLING_ATTRIBUTION_HEADER] = serializeBillingAttributionHeader(
      ctx.metadata.billingAttribution
    )

    const body: Record<string, unknown> = {
      messages,
      workspaceId: ctx.workspaceId || '',
      userId: ctx.userId || '',
      chatId,
      messageId,
      requestId,
      secretScope: secretMountPolicy.secretScope,
      mountedSecrets: secretMountPolicy.mountedSecrets,
      ...(fileAttachments && { fileAttachments }),
      ...(mcpTools.length > 0 ? { mcpTools } : {}),
      ...(skillContexts.length > 0 ? { contexts: skillContexts } : {}),
      ...(ctx.workflowId ? { workflowId: ctx.workflowId } : {}),
      ...(ctx.executionId ? { executionId: ctx.executionId } : {}),
    }

    logger.info('Executing Mothership block', {
      blockId: block.id,
      messageId,
      requestId,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      fileAttachmentCount: fileAttachments?.length ?? 0,
      mcpToolCount: mcpTools.length,
      skillCount: skillContexts.length,
    })

    const abortController = new AbortController()
    const onAbort = () => {
      if (!abortController.signal.aborted) {
        abortController.abort(ctx.abortSignal?.reason ?? 'workflow_abort')
      }
    }

    if (ctx.abortSignal?.aborted) {
      onAbort()
    } else {
      ctx.abortSignal?.addEventListener('abort', onAbort, { once: true })
    }

    const cleanupAbortListeners = () => {
      ctx.abortSignal?.removeEventListener('abort', onAbort)
    }

    let response: Response
    let cleanupImmediately = true
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const expectsProvenance = inspectMothershipResponseCapability(response, resultRegistry)
        if (expectsProvenance) {
          let payload: MothershipExecuteResult
          try {
            payload = (await response.clone().json()) as MothershipExecuteResult
          } catch {
            resultRegistry?.markIncomplete('mothership-response-unreadable')
            throw new Error('Mothership response provenance metadata is invalid')
          }
          await consumeMothershipProvenance(payload, response, resultRegistry)
        }
        const errorMsg = await extractAPIErrorMessage(response)
        throw new Error(`Sim execution failed: ${errorMsg}`)
      }

      if (isContentSelectedForStreaming(ctx, block)) {
        const streamingExecution = createMothershipStreamingExecution(response, chatId, block.id, {
          onCancel: (reason) => {
            if (!abortController.signal.aborted) {
              abortController.abort(reason ?? 'mothership_stream_cancelled')
            }
          },
          onDone: cleanupAbortListeners,
          registry: resultRegistry,
        })
        streamingExecution.diagnosticResolvedSecretTraceRegistry = resultRegistry
        if (resultRegistry) ctx.resolvedSecretTraceRegistry = resultRegistry
        cleanupImmediately = false
        return streamingExecution
      }

      const result = await readMothershipExecuteResponse(response, resultRegistry)
      const output = formatMothershipBlockOutput(result, chatId)
      if (resultRegistry) ctx.resolvedSecretTraceRegistry = resultRegistry
      return output
    } catch (error) {
      ctx.errorResolvedSecretTraceRegistry = resultRegistry
      if (resultRegistry) {
        ctx.resolvedSecretTraceRegistry = resultRegistry.forkForPropagatedEntries()
      }
      throw error
    } finally {
      if (cleanupImmediately) {
        cleanupAbortListeners()
      }
    }
  }
}
