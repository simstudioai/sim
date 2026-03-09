import { getBaseUrl } from '@/lib/core/utils/urls'

export async function GET() {
  const baseUrl = getBaseUrl()

  return new Response(null, {
    status: 301,
    headers: {
      Location: `${baseUrl}/.well-known/security.txt`,
    },
  })
}
