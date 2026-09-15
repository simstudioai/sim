import { z } from 'zod'
import type { InputFormatField } from '@/lib/workflows/types'
import type { UserFile } from '@/executor/types'
import { isSafeKey } from '@/tools/safe-assign'

/**
 * Canonical uploaded file references for workflow inputs. File ownership is checked
 * by the executor against the run's workspace, after input-shape validation.
 */
const workflowInputFileSchema = z
  .object({
    id: z.string().min(1, 'File id cannot be empty'),
    name: z.string().min(1, 'File name cannot be empty'),
    url: z.string().min(1, 'File url cannot be empty'),
    size: z.number().nonnegative(),
    type: z.string().min(1, 'File MIME type cannot be empty'),
    key: z.string().min(1, 'File storage key cannot be empty'),
  })
  .passthrough() satisfies z.ZodType<
  Pick<UserFile, 'id' | 'name' | 'url' | 'size' | 'type' | 'key'>
>

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
    case 'file[]':
      return z.array(workflowInputFileSchema)
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
        (field.type === 'file[]'
          ? 'Array of uploaded file objects. Include each file id, name, url, size, MIME type, and storage key.'
          : name)
    )
    shape[name] = field.value !== undefined && field.value !== null ? schema.optional() : schema
  }

  return shape
}
