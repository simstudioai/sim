/**
 * Safe localStorage utilities with SSR support
 * Provides clean error handling and type safety for browser storage operations
 */

import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('BrowserStorage')

/**
 * Safe localStorage operations with fallbacks
 */
export class BrowserStorage {
  /**
   * Safely gets an item from localStorage
   * @param key - The storage key
   * @param defaultValue - The default value to return if key doesn't exist or access fails
   * @returns The stored value or default value
   */
  static getItem<T = string>(key: string, defaultValue: T): T {
    if (typeof window === 'undefined') {
      return defaultValue
    }

    try {
      const item = window.localStorage.getItem(key)
      if (item === null) {
        return defaultValue
      }

      try {
        return JSON.parse(item) as T
      } catch {
        return item as T
      }
    } catch (error) {
      logger.warn(`Failed to get localStorage item "${key}":`, error)
      return defaultValue
    }
  }

  /**
   * Safely sets an item in localStorage
   * @param key - The storage key
   * @param value - The value to store
   * @returns True if successful, false otherwise
   */
  static setItem<T>(key: string, value: T): boolean {
    if (typeof window === 'undefined') {
      return false
    }

    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value)
      window.localStorage.setItem(key, serializedValue)
      return true
    } catch (error) {
      logger.warn(`Failed to set localStorage item "${key}":`, error)
      return false
    }
  }

  /**
   * Safely removes an item from localStorage
   * @param key - The storage key to remove
   * @returns True if successful, false otherwise
   */
  static removeItem(key: string): boolean {
    if (typeof window === 'undefined') {
      return false
    }

    try {
      window.localStorage.removeItem(key)
      return true
    } catch (error) {
      logger.warn(`Failed to remove localStorage item "${key}":`, error)
      return false
    }
  }

  /**
   * Check if localStorage is available
   * @returns True if localStorage is available and accessible
   */
  static isAvailable(): boolean {
    if (typeof window === 'undefined') {
      return false
    }

    try {
      const testKey = '__test_localStorage_availability__'
      window.localStorage.setItem(testKey, 'test')
      window.localStorage.removeItem(testKey)
      return true
    } catch {
      return false
    }
  }
}

/**
 * Constants for localStorage keys to avoid typos and provide centralized management
 */
export const STORAGE_KEYS = {
  LANDING_PAGE_PROMPT: 'sim_landing_page_prompt',
} as const

/**
 * Specialized utility for managing the landing page prompt
 */
export class LandingPromptStorage {
  private static readonly KEY = STORAGE_KEYS.LANDING_PAGE_PROMPT

  /**
   * Store a prompt from the landing page
   * @param prompt - The prompt text to store
   * @returns True if successful, false otherwise
   */
  static store(prompt: string): boolean {
    if (!prompt || prompt.trim().length === 0) {
      return false
    }

    const data = {
      prompt: prompt.trim(),
      timestamp: Date.now(),
    }

    return BrowserStorage.setItem(LandingPromptStorage.KEY, data)
  }

  /**
   * Retrieve and consume the stored prompt
   * @param maxAge - Maximum age of the prompt in milliseconds (default: 24 hours)
   * @returns The stored prompt or null if not found/expired
   */
  static consume(maxAge: number = 24 * 60 * 60 * 1000): string | null {
    const data = BrowserStorage.getItem<{ prompt: string; timestamp: number } | null>(
      LandingPromptStorage.KEY,
      null
    )

    if (!data || !data.prompt || !data.timestamp) {
      return null
    }

    const age = Date.now() - data.timestamp
    if (age > maxAge) {
      LandingPromptStorage.clear()
      return null
    }

    LandingPromptStorage.clear()
    return data.prompt
  }

  /**
   * Check if there's a stored prompt without consuming it
   * @param maxAge - Maximum age of the prompt in milliseconds (default: 24 hours)
   * @returns True if there's a valid prompt, false otherwise
   */
  static hasPrompt(maxAge: number = 24 * 60 * 60 * 1000): boolean {
    const data = BrowserStorage.getItem<{ prompt: string; timestamp: number } | null>(
      LandingPromptStorage.KEY,
      null
    )

    if (!data || !data.prompt || !data.timestamp) {
      return false
    }

    const age = Date.now() - data.timestamp
    if (age > maxAge) {
      LandingPromptStorage.clear()
      return false
    }

    return true
  }

  /**
   * Clear the stored prompt
   * @returns True if successful, false otherwise
   */
  static clear(): boolean {
    return BrowserStorage.removeItem(LandingPromptStorage.KEY)
  }
}
