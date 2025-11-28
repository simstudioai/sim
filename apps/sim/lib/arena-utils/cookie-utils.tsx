'use client'
import Cookies from 'js-cookie'

const COOKIE_NAME = 'arena_token'

export async function getArenaToken(): Promise<string | null> {
  // 1. Check if cookie exists
  const existingToken = Cookies.get(COOKIE_NAME)
  if (existingToken) {
    return existingToken
  }

  // 2. If not in cookies, call API
  try {
    const res = await fetch('/api/arena/token', { method: 'GET' })
    if (!res.ok) {
      console.error('Failed to fetch arena token')
      return null
    }

    const data = await res.json()
    if (data.found && data.arenaToken) {
      // 3. Save token in cookie (session cookie — no expiry, no secure)
      Cookies.set(COOKIE_NAME, data.arenaToken, {
        sameSite: 'Lax',
      })

      return data.arenaToken
    }

    return null
  } catch (err) {
    console.error('Error fetching arena token:', err)
    return null
  }
}
