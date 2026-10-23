import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { workflowFileInputSchema } from '@/lib/workflows/input-file-schema'
import {
  canonicalInputFormatFieldType,
  INPUT_FORMAT_FIELD_TYPES,
  type InputFormatFieldType,
} from '@/lib/workflows/input-format-schema'
import type { InputFormatField } from '@/lib/workflows/types'
import { isSafeKey } from '@/tools/safe-assign'

function fieldTypeToSchema(type: InputFormatFieldType): z.ZodType {
  switch (type) {
    case 'string':
      return z.string()
    case 'number':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'object':
      return z.record(z.string(), z.unknown())
    case 'array':
      return z.array(z.unknown())
    case 'file[]':
      return z.array(workflowFileInputSchema)
  }
}

/**
 * Shared by workflow run validation and MCP discovery so the advertised input
 * types match execution. The executor supplies configured defaults at run time.
 *
 * @throws OrchestrationError `validation` when a field name is reserved or its
 * type is not one a workflow input can declare.
 */
export function generateWorkflowInputShape(inputFormat: InputFormatField[]): z.ZodRawShape {
  const shape: Record<string, z.ZodType> = {}

  for (const field of inputFormat) {
    const name = field.name?.trim()
    if (!name) continue
    if (!isSafeKey(name)) {
      throw new OrchestrationError(
        'validation',
        `Workflow input name "${name}" is reserved. Rename this input field.`
      )
    }
    const type = canonicalInputFormatFieldType(field.type)
    if (!type) {
      throw new OrchestrationError(
        'validation',
        `Workflow input "${name}" has unsupported type "${field.type}". Use one of: ${INPUT_FORMAT_FIELD_TYPES.join(', ')}.`
      )
    }

    const schema = fieldTypeToSchema(type).describe(
      field.description?.trim() ||
        (type === 'file[]'
          ? 'Files: use an existing workspace file ID/key, a file upload {type:"file",data:"data:<mime>;base64,...",name}, or URL {type:"url",data:"https://...",name}. Stored metadata and access are rechecked when the workflow runs.'
          : name)
    )
    shape[name] = field.value !== undefined && field.value !== null ? schema.optional() : schema
  }

  return shape
}
