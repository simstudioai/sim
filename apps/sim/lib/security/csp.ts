import { env } from '../env'

/**
 * Content Security Policy (CSP) configuration builder
 * This creates a more maintainable and readable CSP configuration
 */

export interface CSPDirectives {
  'default-src'?: string[]
  'script-src'?: string[]
  'style-src'?: string[]
  'img-src'?: string[]
  'media-src'?: string[]
  'font-src'?: string[]
  'connect-src'?: string[]
  'frame-src'?: string[]
  'frame-ancestors'?: string[]
  'form-action'?: string[]
  'base-uri'?: string[]
  'object-src'?: string[]
}

export const cspDirectives: CSPDirectives = {
  'default-src': ["'self'"],

  'script-src': [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    'https://*.google.com',
    'https://apis.google.com',
    'https://*.vercel-scripts.com',
    'https://*.vercel-insights.com',
    'https://vercel.live',
    'https://*.vercel.live',
    'https://vercel.com',
    'https://*.vercel.app',
    'https://vitals.vercel-insights.com',
    'https://b2bjsstore.s3.us-west-2.amazonaws.com',
  ],

  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],

  'img-src': [
    "'self'",
    'data:',
    'blob:',
    'https://*.googleusercontent.com',
    'https://*.google.com',
    'https://*.atlassian.com',
    'https://cdn.discordapp.com',
    'https://*.githubusercontent.com',
    'https://*.public.blob.vercel-storage.com',
  ],

  'media-src': ["'self'", 'blob:'],

  'font-src': ["'self'", 'https://fonts.gstatic.com'],

  'connect-src': [
    "'self'",
    env.NEXT_PUBLIC_APP_URL || '',
    env.OLLAMA_URL || 'http://localhost:11434',
    env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3002',
    env.NEXT_PUBLIC_SOCKET_URL?.replace('http://', 'ws://').replace('https://', 'wss://') ||
      'ws://localhost:3002',
    'https://*.up.railway.app',
    'wss://*.up.railway.app',
    'https://api.browser-use.com',
    'https://api.exa.ai',
    'https://api.firecrawl.dev',
    'https://*.googleapis.com',
    'https://*.amazonaws.com',
    'https://*.s3.amazonaws.com',
    'https://*.blob.core.windows.net',
    'https://*.vercel-insights.com',
    'https://vitals.vercel-insights.com',
    'https://*.atlassian.com',
    'https://*.supabase.co',
    'https://vercel.live',
    'https://*.vercel.live',
    'https://vercel.com',
    'https://*.vercel.app',
    'wss://*.vercel.app',
  ],

  // Google Picker and Drive integration
  'frame-src': [
    'https://drive.google.com',
    'https://docs.google.com', // Required for Google Picker
    'https://*.google.com',
  ],

  'frame-ancestors': ["'self'"],
  'form-action': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
}

/**
 * Build CSP string from directives object
 */
export function buildCSPString(directives: CSPDirectives): string {
  return Object.entries(directives)
    .map(([directive, sources]) => {
      if (!sources || sources.length === 0) return ''
      // Filter out empty strings
      const validSources = sources.filter((source: string) => source && source.trim() !== '')
      if (validSources.length === 0) return ''
      return `${directive} ${validSources.join(' ')}`
    })
    .filter(Boolean)
    .join('; ')
}

/**
 * Get the main CSP policy string
 */
export function getMainCSPPolicy(): string {
  return buildCSPString(cspDirectives)
}

/**
 * Permissive CSP for workflow execution endpoints
 */
export function getWorkflowExecutionCSPPolicy(): string {
  return "default-src * 'unsafe-inline' 'unsafe-eval'; connect-src *;"
}

/**
 * Add a source to a specific directive
 */
export function addCSPSource(directive: keyof CSPDirectives, source: string): void {
  if (!cspDirectives[directive]) {
    cspDirectives[directive] = []
  }
  if (!cspDirectives[directive]!.includes(source)) {
    cspDirectives[directive]!.push(source)
  }
}

/**
 * Remove a source from a specific directive
 */
export function removeCSPSource(directive: keyof CSPDirectives, source: string): void {
  if (cspDirectives[directive]) {
    cspDirectives[directive] = cspDirectives[directive]!.filter((s: string) => s !== source)
  }
}
