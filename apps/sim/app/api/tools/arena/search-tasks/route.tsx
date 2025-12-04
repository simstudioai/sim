import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import { getArenaTokenByWorkflowId } from '../utils/db-utils'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const searchParams = new URLSearchParams(url.searchParams)
    // Extract workflowId separately
    const workflowId = searchParams.get('workflowId')
    if (!workflowId) {
      return NextResponse.json({ error: 'workflowId is required' }, { status: 400 })
    }
    const tokenObject = await getArenaTokenByWorkflowId(workflowId)
    if (tokenObject.found === false) {
      return NextResponse.json(
        { error: 'Failed to create task', details: tokenObject.reason },
        { status: 400 }
      )
    }
    const { arenaToken } = tokenObject

    // Remove workflowId so it doesn't get sent to Arena
    searchParams.delete('workflowId')
    const params = searchParams.toString()

    // Reconstruct Arena API URL with remaining params
    const arenaBackendBaseUrl = env.ARENA_BACKEND_BASE_URL
    const arenaUrl = `${arenaBackendBaseUrl}/sol/v1/tasks/users?${params}`

    const response = await fetch(arenaUrl, {
      method: 'GET',
      headers: {
        accept: '*/*',
        'accept-language': 'en-GB,en;q=0.9',
        //authorisation: process.env.ARENA_AUTH_TOKEN || '', // 🔑 from .env
        authorisation: arenaToken || '', // ⬅️ Use env var for security
      },
    })

    if (!response.ok) {
      const err = await response.text()
      return NextResponse.json(
        { error: 'Failed to fetch from Arena', details: err },
        { status: response.status }
      )
    }

    const data = await response.json()
    const formattedData = data.tasks.map((task: any) => ({
      ...task,
      redirectUrl: `${env.ARENA_FRONTEND_APP_URL}/arn/home?sysId=${task.sysId}`,
    }))

    // Optionally attach workflowId to response if you need it
    return NextResponse.json(formattedData)
  } catch (err: any) {
    return NextResponse.json({ error: 'Unexpected error', details: err.message }, { status: 500 })
  }
}
