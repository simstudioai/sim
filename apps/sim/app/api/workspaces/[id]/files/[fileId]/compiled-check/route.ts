import { NextResponse } from 'next/server'
import { workspaceFileCompiledCheckContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalPlainFileErrorPolicy } from '@/lib/workspace-files/api'
import {
  CompiledCheckTooLargeError,
  CompiledCheckUnsupportedError,
  compiledCheckWorkspaceFile,
} from '@/lib/workspace-files/application/compiled-check-workspace-file'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const compiledCheckErrorPolicy = {
  ...internalPlainFileErrorPolicy,
  render(error: unknown) {
    if (error instanceof CompiledCheckUnsupportedError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    if (error instanceof CompiledCheckTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 })
    }
    return internalPlainFileErrorPolicy.render(error)
  },
}

export const GET = defineInternalJsonRoute({
  contract: workspaceFileCompiledCheckContract,
  auth: internalSessionAuth,
  operation: compiledCheckWorkspaceFile.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal compiled-check behavior',
  }),
  errorPolicy: compiledCheckErrorPolicy,
  mapInput: ({ params }) => ({ fileId: params.fileId, assertedWorkspaceId: params.id }),
  useCase: compiledCheckWorkspaceFile,
  present: (result) => result,
})
