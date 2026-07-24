/**
 * Health check endpoint for deployment platforms and container probes.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return Response.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      ...(process.env.E2E_RUN_ID ? { runId: process.env.E2E_RUN_ID } : {}),
    },
    { status: 200 }
  )
}
