import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { asanaAddFollowersContract } from '@/lib/api/contracts/tools/asana'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('AsanaAddFollowersAPI')

interface AsanaFollower {
  gid: string
  name: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(asanaAddFollowersContract, request, {})
    if (!parsed.success) return parsed.response
    const { accessToken, taskGid, followers } = parsed.data.body

    const taskGidValidation = validateAlphanumericId(taskGid, 'taskGid', 100)
    if (!taskGidValidation.isValid) {
      return NextResponse.json({ error: taskGidValidation.error }, { status: 400 })
    }

    for (const follower of followers) {
      const followerValidation = validateAlphanumericId(follower, 'follower', 100)
      if (!followerValidation.isValid) {
        return NextResponse.json({ error: followerValidation.error }, { status: 400 })
      }
    }

    const url = `https://app.asana.com/api/1.0/tasks/${taskGid}/addFollowers?opt_fields=name,followers.name`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: { followers } }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `Asana API error: ${response.status} ${response.statusText}`

      try {
        const errorData = JSON.parse(errorText)
        const asanaError = errorData.errors?.[0]
        if (asanaError) {
          errorMessage = `${asanaError.message || errorMessage} (${asanaError.help || ''})`
        }
        logger.error('Asana API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData,
        })
      } catch (_e) {
        logger.error('Asana API error (unparsed):', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        })
      }

      return NextResponse.json(
        { success: false, error: errorMessage, details: errorText },
        { status: response.status }
      )
    }

    const result = await response.json()
    const task = result.data
    const taskFollowers: AsanaFollower[] = Array.isArray(task.followers) ? task.followers : []

    return NextResponse.json({
      success: true,
      ts: new Date().toISOString(),
      gid: task.gid,
      name: task.name || '',
      followers: taskFollowers.map((follower) => ({
        gid: follower.gid,
        name: follower.name,
      })),
    })
  } catch (error) {
    logger.error('Error adding followers to Asana task:', error)
    return NextResponse.json(
      { error: 'Failed to add followers to Asana task', details: (error as Error).message },
      { status: 500 }
    )
  }
})
