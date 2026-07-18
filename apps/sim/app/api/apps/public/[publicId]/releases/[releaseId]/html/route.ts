import { db } from '@sim/db'
import { appProject, appRelease } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { fixtureAppHtmlContract } from '@/lib/api/contracts/apps'
import { parseRequest } from '@/lib/api/server'
import { requireAppsHopFromRequest } from '@/lib/apps/hop-proof'
import { getAppOriginStatus } from '@/lib/apps/origin'
import { renderSimAppConfigScript } from '@/lib/apps/safe-json'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/**
 * Serves a minimal HTML shell for hand-authored / fixture releases when
 * artifacts are not yet on disk. Uses the nonce from apps-host/serve-meta so
 * CSP and the config script share one nonce pipeline.
 */
export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ publicId: string; releaseId: string }> }
  ) => {
    const hop = await requireAppsHopFromRequest(request)
    if (!hop.ok) {
      return new Response(hop.message, { status: hop.status })
    }

    const parsed = await parseRequest(fixtureAppHtmlContract, request, context)
    if (!parsed.success) return parsed.response
    const { publicId, releaseId } = parsed.data.params
    const { nonce } = parsed.data.query

    const origin = getAppOriginStatus()
    if (!origin.enabled) {
      return new Response('Apps origin misconfigured', { status: 503 })
    }

    const [project] = await db
      .select()
      .from(appProject)
      .where(and(eq(appProject.publicId, publicId), isNull(appProject.archivedAt)))
      .limit(1)

    if (!project || project.publishedReleaseId !== releaseId) {
      return new Response('Unavailable', { status: 410 })
    }

    const [release] = await db
      .select()
      .from(appRelease)
      .where(
        and(
          eq(appRelease.id, releaseId),
          eq(appRelease.state, 'published'),
          isNull(appRelease.revokedAt)
        )
      )
      .limit(1)

    if (!release) {
      return new Response('Unavailable', { status: 410 })
    }

    const configScript = renderSimAppConfigScript(
      {
        publicId: project.publicId,
        slug: project.slug,
        releaseId: release.id,
        gatewayOrigin: origin.appPublicOrigin,
      },
      nonce
    )

    const title = project.name.replace(/</g, '')
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
${configScript}
</head>
<body>
<main id="root">
  <h1>${title}</h1>
  <p>Sim App fixture shell.</p>
  <button type="button" id="run">Run main</button>
  <pre id="out"></pre>
</main>
<script nonce="${nonce}" type="module">
  import { createSimClient } from '/__fixture__/sim-app-sdk.js';
  const config = window.__SIM_APP_CONFIG;
  const client = createSimClient({ mode: 'published', config });
  document.getElementById('run').onclick = async () => {
    const out = document.getElementById('out');
    out.textContent = 'Running…';
    try {
      const result = await client.run('main', {});
      out.textContent = JSON.stringify(result, null, 2);
    } catch (e) {
      out.textContent = e instanceof Error ? e.message : String(e);
    }
  };
</script>
</body>
</html>`

    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=60',
      },
    })
  }
)
