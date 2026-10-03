import { z } from 'zod'
import { workflowFileInputSchema } from '@/lib/workflows/input-file-schema'
import type { InputFormatField } from '@/lib/workflows/types'
import { isSafeKey } from '@/tools/safe-assign'

function fieldTypeToSchema(type: string | undefined): z.ZodType {
  switch (type) {
    case undefined:
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
    case 'files':
    case 'file[]':
      return z.array(workflowFileInputSchema)
    default:
      throw new Error(`Unsupported workflow input type "${type}"`)
  }
}

/**
 * Shared by workflow run validation and MCP discovery so the advertised input
 * types match execution. The executor supplies configured defaults at run time.
 */
export function generateWorkflowInputShape(inputFormat: InputFormatField[]): z.ZodRawShape {
  const shape: Record<string, z.ZodType> = {}

  for (const field of inputFormat) {
    const name = field.name?.trim()
    if (!name) continue
    if (!isSafeKey(name)) {
      throw new Error(`Workflow input name "${name}" is reserved. Rename this input field.`)
    }

    const schema = fieldTypeToSchema(field.type).describe(
      field.description?.trim() ||
        (field.type === 'file[]' || field.type === 'files'
          ? 'Files: use an existing workspace file ID/key, a file upload {type:"file",data:"data:<mime>;base64,...",name}, or URL {type:"url",data:"https://...",name}. Stored metadata and access are rechecked when the workflow runs.'
          : name)
    )
    shape[name] = field.value !== undefined && field.value !== null ? schema.optional() : schema
  }

  return shape
}
