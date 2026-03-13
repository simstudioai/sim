/**
 * Health check endpoint for deployment platforms and container probes.
 */
export async function GET(): Promise<Response> {
  return Response.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  )
}
