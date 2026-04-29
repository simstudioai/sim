/**
 * Health check endpoint for deployment platforms and container probes.
 */
import { noInputSchema } from '@/lib/api/contracts/primitives'
import { validateSchema } from '@/lib/api/server'

export async function GET(): Promise<Response> {
  const validation = validateSchema(noInputSchema, {})
  if (!validation.success) return validation.response

  return Response.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  )
}
