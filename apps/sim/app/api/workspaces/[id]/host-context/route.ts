import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getWorkspaceHostContextContract } from '@/lib/api/contracts/workspaces'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getWorkspaceHostContextContract, request, context)
    if (!parsed.success) return parsed.response

    const hostContext = await getWorkspaceHostContextForViewer(
      parsed.data.params.id,
      session.user.id
    )
    if (!hostContext) {
      return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 })
    }

    return NextResponse.json(hostContext)
  }
)
