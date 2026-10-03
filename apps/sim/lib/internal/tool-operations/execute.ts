import type {
  InternalToolOperationCall,
  InternalToolOperationImplementation,
} from '@/lib/internal/tool-operations/types'

/** Executes one typed operation implementation behind a registered tool handler. */
export async function executeToolOperationImplementation<Input extends object>(
  operation: InternalToolOperationImplementation<Input>,
  request: InternalToolOperationCall
): Promise<Response> {
  if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) {
    return Response.json({ success: false, error: 'Invalid operation input' }, { status: 400 })
  }

  request.signal?.throwIfAborted()
  const result = await operation(request.input as Input, request.signal, request.context)
  return Response.json(result)
}
