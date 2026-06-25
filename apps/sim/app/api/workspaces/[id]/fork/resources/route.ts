import { db } from '@sim/db'
import { type NextRequest, NextResponse } from 'next/server'
import { getForkResourcesContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { assertWorkspaceReadAccess } from '@/lib/workspaces/fork/lineage/authz'
import { listForkCopyableResources } from '@/lib/workspaces/fork/mapping/resources'

export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getForkResourcesContract, req, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params

    await assertWorkspaceReadAccess(id, session.user.id)

    const resources = await listForkCopyableResources(db, id)
    return NextResponse.json(resources)
  }
)
