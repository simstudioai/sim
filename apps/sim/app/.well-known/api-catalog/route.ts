import { NextResponse } from 'next/server'
import { getV2ApiLinks } from '@/lib/api/links'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/** RFC 9727 §4.2: the catalog is a Linkset carrying the RFC's profile. */
const API_CATALOG_CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'

/**
 * RFC 9727 API catalog: one machine-readable entry point to the v2 REST API. The first context
 * lists the API as a catalog `item` (RFC 9727 §3.1); the second links its OpenAPI document
 * (`service-desc`), reference docs (`service-doc`), and health endpoint (`status`) with the
 * RFC 8631 relations. Both anchors are this deployment's own origin, so a self-hosted instance
 * describes itself. The OpenAPI document is the one published contract; its `servers` names Sim
 * Cloud, so a client of another deployment uses the anchor as its base URL, as the API docs say.
 * `Link: rel="api-catalog"` makes a HEAD request discoverable too (RFC 9727 §2).
 */
export const GET = withRouteHandler(() => {
  const baseUrl = getBaseUrl()
  const catalogUrl = `${baseUrl}/.well-known/api-catalog`
  const apiUrl = `${baseUrl}/api/v2`
  const links = getV2ApiLinks()

  return NextResponse.json(
    {
      linkset: [
        { anchor: catalogUrl, item: [{ href: apiUrl }] },
        {
          anchor: apiUrl,
          'service-desc': [{ href: links.openapi, type: 'application/vnd.oai.openapi+json' }],
          'service-doc': [{ href: links.docs, type: 'text/html' }],
          status: [{ href: `${baseUrl}/api/health`, type: 'application/json' }],
        },
      ],
    },
    {
      headers: {
        'Content-Type': API_CATALOG_CONTENT_TYPE,
        'Cache-Control': 'public, max-age=86400',
        Link: `<${catalogUrl}>; rel="api-catalog"`,
      },
    }
  )
})
