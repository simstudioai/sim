import type { NextRequest } from 'next/server'

function getPathSegments(request: NextRequest): string[] {
  return request.nextUrl.pathname.split('/').filter(Boolean)
}

export function getRouteParamFromPath(request: NextRequest, key: string): string | null {
  const segments = getPathSegments(request)
  const index = segments.findIndex((segment) => segment === key)
  if (index === -1 || index + 1 >= segments.length) {
    return null
  }
  return segments[index + 1]
}

export function getProjectIdFromRequest(request: NextRequest): string | null {
  return getRouteParamFromPath(request, 'projects')
}

export function getVersionIdFromRequest(request: NextRequest): string | null {
  return getRouteParamFromPath(request, 'versions')
}

export function getDeploymentIdFromRequest(request: NextRequest): string | null {
  return getRouteParamFromPath(request, 'deployments')
}

export function getTokenIdFromRequest(request: NextRequest): string | null {
  return getRouteParamFromPath(request, 'tokens')
}
