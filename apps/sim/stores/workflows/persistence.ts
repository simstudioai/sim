/**
 * OAuth state persistence for secure OAuth redirects
 * This is the ONLY localStorage usage in the app - for temporary OAuth state during redirects
 */
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('OAuthPersistence')

interface OAuthState {
  providerId: string
  serviceId: string
  requiredScopes: string[]
  returnUrl: string
  context: string
  timestamp: number
  data?: Record<string, any>
}

const OAUTH_STATE_KEY = 'pending_oauth_state'
const OAUTH_STATE_EXPIRY = 10 * 60 * 1000 // 10 minutes

/**
 * Generic function to save data to localStorage (used by main branch OAuth flow)
 */
export function saveToStorage<T>(key: string, data: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(data))
    return true
  } catch (error) {
    logger.error(`Failed to save data to ${key}:`, { error })
    return false
  }
}

/**
 * Generic function to load data from localStorage
 */
export function loadFromStorage<T>(key: string): T | null {
  try {
    const stored = localStorage.getItem(key)
    if (!stored) return null
    return JSON.parse(stored) as T
  } catch (error) {
    logger.error(`Failed to load data from ${key}:`, { error })
    return null
  }
}

/**
 * Save OAuth state to localStorage before redirect
 */
export function saveOAuthState(state: OAuthState): boolean {
  try {
    const stateWithTimestamp = {
      ...state,
      timestamp: Date.now(),
    }
    localStorage.setItem(OAUTH_STATE_KEY, JSON.stringify(stateWithTimestamp))
    return true
  } catch (error) {
    logger.error('Failed to save OAuth state to localStorage:', error)
    return false
  }
}

/**
 * Load and remove OAuth state from localStorage after redirect
 */
export function loadOAuthState(): OAuthState | null {
  try {
    const stored = localStorage.getItem(OAUTH_STATE_KEY)
    if (!stored) return null

    const state = JSON.parse(stored) as OAuthState

    // Check if state has expired
    if (Date.now() - state.timestamp > OAUTH_STATE_EXPIRY) {
      localStorage.removeItem(OAUTH_STATE_KEY)
      logger.warn('OAuth state expired, removing from localStorage')
      return null
    }

    // Remove state after loading (one-time use)
    localStorage.removeItem(OAUTH_STATE_KEY)

    return state
  } catch (error) {
    logger.error('Failed to load OAuth state from localStorage:', error)
    // Clean up corrupted state
    localStorage.removeItem(OAUTH_STATE_KEY)
    return null
  }
}

/**
 * Remove OAuth state from localStorage (cleanup)
 */
export function clearOAuthState(): void {
  try {
    localStorage.removeItem(OAUTH_STATE_KEY)
  } catch (error) {
    logger.error('Failed to clear OAuth state from localStorage:', error)
  }
}

/**
 * Check if there's pending OAuth state
 */
export function hasPendingOAuthState(): boolean {
  try {
    const stored = localStorage.getItem(OAUTH_STATE_KEY)
    if (!stored) return false

    const state = JSON.parse(stored) as OAuthState

    // Check if expired
    if (Date.now() - state.timestamp > OAUTH_STATE_EXPIRY) {
      localStorage.removeItem(OAUTH_STATE_KEY)
      return false
    }

    return true
  } catch (error) {
    logger.error('Failed to check pending OAuth state:', error)
    localStorage.removeItem(OAUTH_STATE_KEY)
    return false
  }
}
