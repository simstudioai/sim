import { z } from 'zod'

/** A stored file is resolved from current metadata in the executing workspace. */
export const workflowStoredFileInputSchema = z.union([
  z.object({ id: z.string().min(1), key: z.string().min(1).optional() }).passthrough(),
  z.object({ key: z.string().min(1) }).passthrough(),
])

/** New file content can be uploaded inline or downloaded through the bounded URL loader. */
export const workflowUploadFileInputSchema = z.object({
  type: z.enum(['file', 'url']),
  data: z.string().min(1),
  name: z.string().min(1),
  mime: z.string().optional(),
})

/** Compatibility with the file shape published by workflow MCP inputs. */
export const workflowMcpFileInputSchema = z.object({
  name: z.string().min(1),
  data: z.string().min(1),
  mimeType: z.string().min(1),
})

export const workflowFileInputSchema = z.union([
  workflowUploadFileInputSchema,
  workflowMcpFileInputSchema,
  workflowStoredFileInputSchema,
])
export type WorkflowFileInput = z.output<typeof workflowFileInputSchema>
