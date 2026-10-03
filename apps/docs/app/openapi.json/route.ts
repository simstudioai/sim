import { createOpenApiDownloadDocument } from '@/lib/openapi-download'

export const revalidate = false

export function GET() {
  return Response.json(createOpenApiDownloadDocument(), {
    headers: {
      'Content-Disposition': 'attachment; filename="sim-openapi-v2.json"',
    },
  })
}
