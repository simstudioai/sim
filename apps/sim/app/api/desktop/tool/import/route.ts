import { DESKTOP_IMPORT_TOKEN_HEADER, MAX_DESKTOP_IMPORT_FILE_BYTES } from '@sim/desktop-bridge'
import { type NextRequest, NextResponse } from 'next/server'
import { importDesktopEntryContract } from '@/lib/api/contracts/desktop-executor'
import { isOffAppHost } from '@/lib/api/mcp/host-routing'
import { parseRequest } from '@/lib/api/server'
import { desktopExecutorRateLimit } from '@/lib/api/server/routes/desktop-executor'
import {
  InternalUnauthenticatedError,
  internalSessionAuth,
} from '@/lib/api/server/routes/internal-json-route'
import { withRequestId } from '@/lib/api/server/routes/request-id'
import { PayloadSizeLimitError, readStreamToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { admitDesktopImportEntry, importDesktopEntry } from '@/lib/desktop/application/import'
import { DesktopDeviceUnrecognizedError } from '@/lib/desktop/executor/errors'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'

export const dynamic = 'force-dynamic'

const TOO_LARGE = `Desktop imports support files up to ${MAX_DESKTOP_IMPORT_FILE_BYTES / 1024 / 1024} MB`

/**
 * PUT /api/desktop/tool/import?…
 *
 * Raw `withRouteHandler`: a file's bytes are the request body, so the entry is admitted by its
 * declared length and its claimed import before the body is read under a byte ceiling, then
 * handed to the use case that re-validates the claim and stores it.
 */
export const PUT = withRouteHandler(async (request: NextRequest) => {
  if (isOffAppHost(request))
    return NextResponse.json(withRequestId({ error: 'Not found' }), { status: 404 })
  let principal
  try {
    principal = await internalSessionAuth.authenticate()
  } catch (error) {
    if (error instanceof InternalUnauthenticatedError) {
      return NextResponse.json(withRequestId({ error: error.message }), { status: 401 })
    }
    throw error
  }
  const limited = await desktopExecutorRateLimit.enforce(request, principal)
  if (limited) return limited
  const parsed = await parseRequest(importDesktopEntryContract, request, {})
  if (!parsed.success) return parsed.response
  const query = {
    ...parsed.data.query,
    executionToken: parsed.data.headers[DESKTOP_IMPORT_TOKEN_HEADER],
  }
  const lengthHeader = request.headers.get('content-length')
  const declaredLength = Number(lengthHeader ?? 0)
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_DESKTOP_IMPORT_FILE_BYTES) {
    return NextResponse.json(withRequestId({ error: TOO_LARGE }), { status: 413 })
  }
  if (query.kind === 'file' && lengthHeader === null) {
    return NextResponse.json(withRequestId({ error: 'A file import must declare its length' }), {
      status: 411,
    })
  }

  try {
    await admitDesktopImportEntry(principal, query)
  } catch (error) {
    return importErrorResponse(error)
  }

  let content: Buffer | undefined
  if (query.kind === 'file') {
    try {
      content = await readStreamToBufferWithLimit(request.body, {
        maxBytes: MAX_DESKTOP_IMPORT_FILE_BYTES,
        label: 'Desktop import',
        signal: request.signal,
      })
    } catch (error) {
      if (error instanceof PayloadSizeLimitError) {
        return NextResponse.json(withRequestId({ error: TOO_LARGE }), { status: 413 })
      }
      throw error
    }
    // Anything between the device and here that cut the body short must not become a stored file.
    if (content.length !== declaredLength) {
      return NextResponse.json(
        withRequestId({ error: 'The file did not arrive whole; nothing was stored' }),
        { status: 400 }
      )
    }
  }

  try {
    const entry = await importDesktopEntry.execute({
      principal,
      input: { ...query, ...(content ? { content } : {}) },
      request,
    })
    return NextResponse.json({ id: entry.id, name: entry.name })
  } catch (error) {
    return importErrorResponse(error)
  }
})

/** A device Sim no longer recognizes registers again; everything else hides what it guards. */
function importErrorResponse(error: unknown): NextResponse {
  if (error instanceof DesktopDeviceUnrecognizedError) {
    return NextResponse.json(withRequestId({ error: error.message }), { status: 401 })
  }
  const response = internalFileErrorPolicies.concealContentAuthorization.project(error)
  if (!response) throw error
  return NextResponse.json(withRequestId(response.body), {
    status: response.status,
    headers: response.headers,
  })
}
