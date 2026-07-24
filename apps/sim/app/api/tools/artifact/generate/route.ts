import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { artifactGenerateContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  requireBillingAttributionHeader,
  resolveBillingAttribution,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { checkAndBillPayerOverageThreshold } from '@/lib/billing/threshold-billing'
import { generateRequestId } from '@/lib/core/utils/request'
import { ensureAbsoluteUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { ShareValidationError, upsertFileShare } from '@/lib/public-shares/share-manager'
import { ensureWorkspaceFileFolderPath } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import {
  assertPermissionsAllowed,
  ModelNotAllowedError,
  ProviderNotAllowedError,
  PublicFileSharingNotAllowedError,
  validatePublicFileSharing,
} from '@/ee/access-control/utils/permission-check'
import { executeProviderRequest } from '@/providers'
import { getProviderFromModel } from '@/providers/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ArtifactGenerateAPI')

/** Name of the auto-created workspace folder that collects generated artifacts. */
const ARTIFACTS_FOLDER_NAME = 'Artifacts'

/** Hard cap on the generated document size so a runaway model cannot fill storage. */
const MAX_ARTIFACT_HTML_BYTES = 5 * 1024 * 1024

/**
 * Design contract for generated artifacts. Written to satisfy the sandboxed
 * HTML viewer's CSP exactly (`default-src 'none'; connect-src 'none'` with
 * inline script/style allowed), so the page renders identically in the Files
 * preview and on public share links.
 */
const ARTIFACT_SYSTEM_PROMPT = `You are an expert front-end designer producing a single, completely self-contained HTML page.

Hard technical constraints (the page renders inside a sandboxed iframe with the Content-Security-Policy "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'"):
- Output exactly ONE complete HTML document starting with <!DOCTYPE html> and ending with </html>.
- ALL CSS must be inline in <style> tags. ALL JavaScript must be inline in <script> tags.
- NEVER reference any external URL: no CDN scripts, no external stylesheets, no webfonts, no remote images, no fetch/XHR/WebSocket calls, no <iframe>, no <form> submissions. They are all blocked and will break the page.
- Images only as data: URIs or inline <svg>. Prefer inline SVG for icons and illustrations.
- Fonts: use a system font stack only (e.g. system-ui, -apple-system, 'Segoe UI', sans-serif).
- Links to external sites are blocked by the viewer; avoid <a href> to external URLs.

Design requirements:
- Polished, modern, and readable: clear typographic hierarchy, generous whitespace, a restrained color palette, and consistent spacing.
- Responsive: use relative units and flexible layouts; wide content (tables, code) scrolls inside its own container; the page body must never scroll horizontally.
- Support both light and dark environments gracefully (prefers-color-scheme) unless the requested design dictates otherwise.
- Present the provided data faithfully — never invent, alter, or omit values. Format numbers, dates, and lists for readability.

Output rules:
- Respond with the raw HTML document only. No markdown fences, no commentary, no explanation before or after.`

interface ProviderCredentialParams {
  apiKey?: string
  azureEndpoint?: string
  azureApiVersion?: string
  vertexProject?: string
  vertexLocation?: string
  vertexCredential?: string
  bedrockAccessKeyId?: string
  bedrockSecretKey?: string
  bedrockRegion?: string
}

function buildUserPrompt(title: string, content: string, designInstructions?: string): string {
  const sections = [
    `Artifact title: ${title}`,
    designInstructions ? `Design instructions from the user:\n${designInstructions}` : null,
    `Source content to present (workflow output data):\n${content}`,
  ].filter(Boolean)
  return sections.join('\n\n')
}

/** Strips a leading/trailing markdown code fence if the model added one. */
function stripHtmlFences(raw: string): string {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/)
  return fenceMatch ? fenceMatch[1].trim() : trimmed
}

function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'artifact'
}

function resolveFileName(fileName: string | undefined, title: string): string {
  const base = fileName?.trim() || `${slugifyTitle(title)}.html`
  return base.toLowerCase().endsWith('.html') ? base : `${base}.html`
}

/**
 * Vertex requests authenticate with a refreshed OAuth access token instead of a
 * static key; mirror the guardrails hallucination flow.
 */
async function resolveVertexApiKey(
  requestId: string,
  credentials: ProviderCredentialParams,
  providerId: string
): Promise<string | undefined> {
  if (providerId !== 'vertex' || !credentials.vertexCredential) return credentials.apiKey

  const credential = await db.query.account.findFirst({
    where: eq(account.id, credentials.vertexCredential),
  })
  if (!credential) return credentials.apiKey

  const { accessToken } = await refreshTokenIfNeeded(
    requestId,
    credential,
    credentials.vertexCredential
  )
  return accessToken ?? credentials.apiKey
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(artifactGenerateContract, request, {})
  if (!parsed.success) return parsed.response
  const { body } = parsed.data
  const { title, content, designInstructions, model, fileName, createShareLink, workflowId } = body

  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId: auth.userId,
    action: 'write',
  })
  if (!authorization.allowed || !authorization.workflow?.workspaceId) {
    return NextResponse.json(
      { error: authorization.message ?? 'Workflow not found or access denied' },
      { status: authorization.allowed ? 403 : authorization.status }
    )
  }
  const workspaceId = authorization.workflow.workspaceId

  let billingAttribution: BillingAttributionSnapshot
  try {
    billingAttribution =
      auth.authType === AuthType.INTERNAL_JWT
        ? requireBillingAttributionHeader(request.headers, {
            actorUserId: auth.userId,
            workspaceId,
          })
        : await resolveBillingAttribution({
            actorUserId: auth.userId,
            workspaceId,
          })
  } catch (error) {
    logger.error(`[${requestId}] Failed to establish billing attribution`, { error })
    return NextResponse.json({ error: 'Failed to resolve billing attribution' }, { status: 400 })
  }

  try {
    await assertPermissionsAllowed({ userId: auth.userId, workspaceId, model })
  } catch (error) {
    if (error instanceof ProviderNotAllowedError || error instanceof ModelNotAllowedError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    throw error
  }

  const usage = await checkAttributedUsageLimits(billingAttribution)
  if (usage.isExceeded) {
    return NextResponse.json(
      { error: usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.' },
      { status: 402 }
    )
  }

  const providerId = getProviderFromModel(model)

  logger.info(`[${requestId}] Generating HTML artifact`, {
    workflowId,
    workspaceId,
    model,
    contentLength: content.length,
  })

  let html: string
  let cost = 0
  try {
    const apiKey = await resolveVertexApiKey(requestId, body, providerId)

    const response = await executeProviderRequest(providerId, {
      model,
      systemPrompt: ARTIFACT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(title, content, designInstructions) }],
      temperature: 0.3,
      apiKey,
      azureEndpoint: body.azureEndpoint,
      azureApiVersion: body.azureApiVersion,
      vertexProject: body.vertexProject,
      vertexLocation: body.vertexLocation,
      bedrockAccessKeyId: body.bedrockAccessKeyId,
      bedrockSecretKey: body.bedrockSecretKey,
      bedrockRegion: body.bedrockRegion,
      workflowId,
      workspaceId,
    })

    if (response instanceof ReadableStream || ('stream' in response && 'execution' in response)) {
      throw new Error('Unexpected streaming response from LLM')
    }

    // executeProviderRequest already zeroes cost for BYOK / non-hosted models,
    // so this is the billable amount as-is.
    cost = typeof response.cost?.total === 'number' ? response.cost.total : 0
    html = stripHtmlFences(response.content)
  } catch (error) {
    logger.error(`[${requestId}] Artifact generation LLM call failed`, { error })
    return NextResponse.json(
      { error: `Failed to generate artifact: ${getErrorMessage(error, 'LLM request failed')}` },
      { status: 502 }
    )
  }

  const lowerHtml = html.toLowerCase()
  if (!lowerHtml.includes('<html') || !lowerHtml.includes('</html>')) {
    logger.warn(`[${requestId}] Generated artifact is not a complete HTML document`, {
      length: html.length,
    })
    return NextResponse.json(
      {
        error:
          'The model did not return a complete HTML document (possibly truncated). Try a shorter content input or a model with a larger output limit.',
      },
      { status: 502 }
    )
  }

  const htmlBuffer = Buffer.from(html, 'utf-8')
  if (htmlBuffer.length > MAX_ARTIFACT_HTML_BYTES) {
    return NextResponse.json(
      {
        error: `Generated artifact exceeds the ${MAX_ARTIFACT_HTML_BYTES / (1024 * 1024)}MB limit`,
      },
      { status: 413 }
    )
  }

  if (cost > 0) {
    const { recordUsage } = await import('@/lib/billing/core/usage-log')
    try {
      await recordUsage({
        userId: auth.userId,
        workspaceId,
        ...toBillingContext(billingAttribution),
        entries: [
          {
            category: 'model',
            source: 'workflow',
            description: `artifact-generate:${model}`,
            cost,
            sourceReference: `artifact:${workflowId}:${requestId}`,
          },
        ],
      })
      await checkAndBillPayerOverageThreshold(billingAttribution.billingEntity)
    } catch (billingError) {
      logger.error(`[${requestId}] Failed to record artifact usage`, { error: billingError })
    }
  }

  const folderId = await ensureWorkspaceFileFolderPath({
    workspaceId,
    userId: auth.userId,
    pathSegments: [ARTIFACTS_FOLDER_NAME],
  })

  const file = await uploadWorkspaceFile(
    workspaceId,
    auth.userId,
    htmlBuffer,
    resolveFileName(fileName, title),
    'text/html',
    { folderId }
  )

  let shareUrl: string | null = null
  if (createShareLink) {
    try {
      await validatePublicFileSharing(auth.userId, workspaceId, 'public')
      const share = await upsertFileShare({
        workspaceId,
        fileId: file.id,
        userId: auth.userId,
        isActive: true,
        authType: 'public',
      })
      shareUrl = share.url
    } catch (error) {
      if (
        error instanceof ShareValidationError ||
        error instanceof PublicFileSharingNotAllowedError
      ) {
        logger.warn(`[${requestId}] Could not create share link for artifact`, {
          error: error.message,
        })
      } else {
        throw error
      }
    }
  }

  logger.info(`[${requestId}] Artifact generated`, {
    fileId: file.id,
    size: htmlBuffer.length,
    shared: Boolean(shareUrl),
  })

  return NextResponse.json({
    success: true,
    output: {
      file: { ...file, url: ensureAbsoluteUrl(file.url) },
      url: ensureAbsoluteUrl(file.url),
      shareUrl,
      title,
      model,
    },
  })
})
