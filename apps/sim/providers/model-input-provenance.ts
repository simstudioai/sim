import { collectModelVisibleSchemaContent } from '@/lib/copilot/model-visible-schema'
import { isProviderAttachmentFilenameModelBound } from '@/providers/attachments'
import { canUseProviderLargeFilePath } from '@/providers/file-attachments.server'
import type { ProviderId, ProviderRequest } from '@/providers/types'

const MAX_PROVIDER_MODEL_INPUT_PROVENANCE_VALUES = 50_000

function schemaProvenanceValues(schema: unknown): unknown[] | undefined {
  try {
    const content = collectModelVisibleSchemaContent(schema)
    return [content.projectedValues, content.guardedValues]
  } catch {
    return undefined
  }
}

/**
 * Selects the dynamic ProviderRequest values that can reach a model. Transport credentials,
 * execution context, opaque file bytes/locations, and validated schema grammar are excluded.
 */
export function collectProviderModelInputProvenanceValues(
  request: ProviderRequest,
  providerId: ProviderId | string
): unknown[] {
  const values: unknown[] = []
  const largeFilePathAvailable = providerId === 'openai' && canUseProviderLargeFilePath(providerId)
  const append = (...candidates: unknown[]): void => {
    for (const candidate of candidates) {
      if (candidate === undefined) continue
      if (values.length >= MAX_PROVIDER_MODEL_INPUT_PROVENANCE_VALUES) {
        throw new Error('Provider model input provenance selection exceeds its safe limit')
      }
      values.push(candidate)
    }
  }

  append(request.systemPrompt, request.context)
  for (const message of request.messages ?? []) {
    append(message.content, message.name)
    if (message.function_call) {
      append(message.function_call.name, message.function_call.arguments)
    }
    for (const toolCall of message.tool_calls ?? []) {
      append(toolCall.function.name, toolCall.function.arguments)
    }
    for (const file of message.files ?? []) {
      if (isProviderAttachmentFilenameModelBound(file, providerId, { largeFilePathAvailable })) {
        append(file.name)
      }
    }
  }
  for (const tool of request.tools ?? []) {
    const schemaValues = schemaProvenanceValues(tool.parameters)
    if (schemaValues) append(tool.id, tool.name, tool.description, ...schemaValues)
  }
  if (request.responseFormat) {
    const schemaValues = schemaProvenanceValues(request.responseFormat.schema)
    if (schemaValues) append(request.responseFormat.name, ...schemaValues)
  }

  return values
}
