import { NextResponse } from 'next/server'
import { workspaceFileStyleContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalPlainFileErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  StyleExtractionUnsupportedError,
  styleWorkspaceFile,
} from '@/lib/workspace-files/application/style-workspace-file'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const styleErrorPolicy = {
  ...internalPlainFileErrorPolicy,
  render(error: unknown) {
    if (error instanceof StyleExtractionUnsupportedError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    return internalPlainFileErrorPolicy.render(error)
  },
}

export const GET = defineInternalJsonRoute({
  contract: workspaceFileStyleContract,
  auth: internalSessionAuth,
  operation: styleWorkspaceFile.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal style behavior' }),
  errorPolicy: styleErrorPolicy,
  mapInput: ({ params }) => ({ fileId: params.fileId, assertedWorkspaceId: params.id }),
  useCase: styleWorkspaceFile,
  present: (result) => workspaceFileStyleContract.response.schema.parse(result),
  responseHeaders: () => ({ 'Cache-Control': 'private, max-age=300' }),
})
