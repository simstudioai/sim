import { handleMcpRequest } from '@/lib/http/mcp'

export const runtime = 'nodejs'
export const maxDuration = 30

export const POST = handleMcpRequest
export const GET = handleMcpRequest
export const DELETE = handleMcpRequest
