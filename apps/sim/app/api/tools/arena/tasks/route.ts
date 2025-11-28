// app/api/create-task/route.ts
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { getArenaTokenByWorkflowId } from '../utils/db-utils'

export async function POST(req: NextRequest) {
  const data = await req.json()
  const { workflowId, ...restData } = data
  const tokenObject = await getArenaTokenByWorkflowId(workflowId)
  if (tokenObject.found === false) {
    return NextResponse.json(
      { error: 'Failed to create task', details: tokenObject.reason },
      { status: 400 }
    )
  }
  const { arenaToken } = tokenObject
  const payload = {
    ...restData,
  }

  try {
    const arenaBackendBaseUrl = env.ARENA_BACKEND_BASE_URL
    const res = await fetch(`${arenaBackendBaseUrl}/sol/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorisation: arenaToken || '', // ⬅️ Use env var for security
      },
      body: JSON.stringify(payload),
    })

    const responseData = await res.json()
    responseData.redirectUrl = `${env.ARENA_FRONTEND_APP_URL}/arn/home?sysId=${responseData.sysId}`

    return NextResponse.json(responseData, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create task', details: error }, { status: 500 })
  }
}