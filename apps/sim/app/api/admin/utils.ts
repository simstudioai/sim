import { NextRequest } from 'next/server'

export function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false
  }

  const token = authHeader.split(' ')[1]

  return token === process.env.ADMIN_PASSWORD
}
