import { NextResponse } from 'next/server'
import { getHtmlRuntimeContract } from '@/lib/api/contracts/file-workflows'
import { parseRequest } from '@/lib/api/server'
import { getEnv } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { htmlContentOrigin } from '@/lib/workspace-files/html-runtime/config'

/** Static public runtime configuration, with no protected resource access. */
export const GET = withRouteHandler(async (request) => {
  const parsed = await parseRequest(getHtmlRuntimeContract, request, {})
  if (!parsed.success) return parsed.response
  const origin = htmlContentOrigin(getEnv('HTML_CONTENT_ORIGIN'), getEnv('NEXT_PUBLIC_APP_URL')!)
  return NextResponse.json(
    getHtmlRuntimeContract.response.schema.parse({ frameUrl: `${origin}/html-frame` }),
    { headers: { 'Cache-Control': 'no-store' } }
  )
})
