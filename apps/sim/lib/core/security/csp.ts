import { env, getEnv } from '../config/env'
import { isDev, isHosted, isReactGrabEnabled } from '../config/feature-flags'

/**
 * Content Security Policy (CSP) configuration builder
 *
 * NOTE: This file is loaded by next.config.ts at build time, before @/ path
 * aliases are resolved. Do NOT import from ../utils/urls (which uses @/ imports).
 * Keep all URL constants local to this file.
 */

const DEFAULT_SOCKET_URL = 'http://localhost:3002'
const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

function toWebSocketUrl(httpUrl: string): string {
  return httpUrl.replace('http://', 'ws://').replace('https://', 'wss://')
}

function getHostnameFromUrl(url: string | undefined): string[] {
  if (!url) return []
  try {
    return [`https://${new URL(url).hostname}`]
  } catch {
    return []
  }
}

export interface CSPDirectives {
  'default-src'?: string[]
  'script-src'?: string[]
  'style-src'?: string[]
  'img-src'?: string[]
  'media-src'?: string[]
  'font-src'?: string[]
  'connect-src'?: string[]
  'worker-src'?: string[]
  'frame-src'?: string[]
  'frame-ancestors'?: string[]
  'form-action'?: string[]
  'base-uri'?: string[]
  'object-src'?: string[]
}

/**
 * Static CSP sources shared between build-time and runtime.
 * Add new domains here — both paths pick them up automatically.
 */
const STATIC_SCRIPT_SRC = [
  "'self'",
  "'unsafe-inline'",
  'https://*.google.com',
  'https://apis.google.com',
  'https://challenges.cloudflare.com',
  ...(isReactGrabEnabled ? ['https://unpkg.com'] : []),
  ...(isHosted
    ? [
        'https://www.googletagmanager.com',
        'https://www.google-analytics.com',
        'https://analytics.ahrefs.com',
      ]
    : []),
] as const

const STATIC_IMG_SRC = [
  "'self'",
  'data:',
  'blob:',
  'https://*.googleusercontent.com',
  'https://*.google.com',
  'https://*.atlassian.com',
  'https://cdn.discordapp.com',
  'https://*.githubusercontent.com',
  'https://*.s3.amazonaws.com',
  'https://s3.amazonaws.com',
  'https://*.amazonaws.com',
  'https://*.blob.core.windows.net',
  'https://github.com/*',
  'https://cursor.com',
  ...(isHosted ? ['https://www.googletagmanager.com', 'https://www.google-analytics.com'] : []),
] as const

const STATIC_CONNECT_SRC = [
  "'self'",
  'https://api.browser-use.com',
  'https://api.elevenlabs.io',
  'wss://api.elevenlabs.io',
  'https://api.exa.ai',
  'https://api.firecrawl.dev',
  'https://*.googleapis.com',
  'https://*.amazonaws.com',
  'https://*.s3.amazonaws.com',
  'https://*.blob.core.windows.net',
  'https://*.atlassian.com',
  'https://*.supabase.co',
  'https://api.github.com',
  'https://github.com/*',
  'https://challenges.cloudflare.com',
  ...(isReactGrabEnabled ? ['https://www.react-grab.com'] : []),
  ...(isDev ? ['ws://localhost:4722'] : []),
  ...(isHosted
    ? [
        'https://www.googletagmanager.com',
        'https://*.google-analytics.com',
        'https://*.analytics.google.com',
        'https://analytics.google.com',
        'https://www.google.com',
        'https://analytics.ahrefs.com',
      ]
    : []),
] as const

const STATIC_FRAME_SRC = [
  "'self'",
  'https://challenges.cloudflare.com',
  'https://drive.google.com',
  'https://docs.google.com',
  'https://*.google.com',
  'https://www.youtube.com',
  'https://player.vimeo.com',
  'https://www.dailymotion.com',
  'https://player.twitch.tv',
  'https://clips.twitch.tv',
  'https://streamable.com',
  'https://fast.wistia.net',
  'https://www.tiktok.com',
  'https://w.soundcloud.com',
  'https://open.spotify.com',
  'https://embed.music.apple.com',
  'https://www.loom.com',
  'https://www.facebook.com',
  'https://www.instagram.com',
  'https://platform.twitter.com',
  'https://rumble.com',
  'https://play.vidyard.com',
  'https://iframe.cloudflarestream.com',
  'https://www.mixcloud.com',
  'https://tenor.com',
  'https://giphy.com',
  ...(isHosted ? ['https://www.googletagmanager.com'] : []),
] as const

// Build-time CSP directives (for next.config.ts)
export const buildTimeCSPDirectives: CSPDirectives = {
  'default-src': ["'self'"],
  'script-src': [...STATIC_SCRIPT_SRC],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],

  'img-src': [
    ...STATIC_IMG_SRC,
    ...(env.S3_BUCKET_NAME && env.AWS_REGION
      ? [`https://${env.S3_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com`]
      : []),
    ...(env.S3_KB_BUCKET_NAME && env.AWS_REGION
      ? [`https://${env.S3_KB_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com`]
      : []),
    ...(env.S3_CHAT_BUCKET_NAME && env.AWS_REGION
      ? [`https://${env.S3_CHAT_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com`]
      : []),
    ...getHostnameFromUrl(env.NEXT_PUBLIC_BRAND_LOGO_URL),
    ...getHostnameFromUrl(env.NEXT_PUBLIC_BRAND_FAVICON_URL),
  ],

  'media-src': ["'self'", 'blob:'],
  'worker-src': ["'self'", 'blob:'],
  'font-src': ["'self'", 'https://fonts.gstatic.com'],

  'connect-src': [
    ...STATIC_CONNECT_SRC,
    env.NEXT_PUBLIC_APP_URL || '',
    ...(env.OLLAMA_URL ? [env.OLLAMA_URL] : isDev ? [DEFAULT_OLLAMA_URL] : []),
    ...(env.NEXT_PUBLIC_SOCKET_URL
      ? [env.NEXT_PUBLIC_SOCKET_URL, toWebSocketUrl(env.NEXT_PUBLIC_SOCKET_URL)]
      : isDev
        ? [DEFAULT_SOCKET_URL, toWebSocketUrl(DEFAULT_SOCKET_URL)]
        : []),
    ...getHostnameFromUrl(env.NEXT_PUBLIC_BRAND_LOGO_URL),
    ...getHostnameFromUrl(env.NEXT_PUBLIC_PRIVACY_URL),
    ...getHostnameFromUrl(env.NEXT_PUBLIC_TERMS_URL),
  ],

  'frame-src': [...STATIC_FRAME_SRC],
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
      const validSources = sources.filter((source: string) => source && source.trim() !== '')
      if (validSources.length === 0) return ''
      return `${directive} ${validSources.join(' ')}`
    })
    .filter(Boolean)
    .join('; ')
}

/**
 * Generate runtime CSP header with dynamic environment variables.
 * Composes from the same STATIC_* constants as buildTimeCSPDirectives,
 * but resolves env vars at request time via getEnv() to fix Docker
 * deployments where build-time values may be stale placeholders.
 */
export function generateRuntimeCSP(): string {
  const appUrl = getEnv('NEXT_PUBLIC_APP_URL') || ''

  const socketUrl = getEnv('NEXT_PUBLIC_SOCKET_URL') || (isDev ? DEFAULT_SOCKET_URL : '')
  const socketWsUrl = socketUrl ? toWebSocketUrl(socketUrl) : ''
  const ollamaUrl = getEnv('OLLAMA_URL') || (isDev ? DEFAULT_OLLAMA_URL : '')

  const brandLogoDomains = getHostnameFromUrl(getEnv('NEXT_PUBLIC_BRAND_LOGO_URL'))
  const brandFaviconDomains = getHostnameFromUrl(getEnv('NEXT_PUBLIC_BRAND_FAVICON_URL'))
  const privacyDomains = getHostnameFromUrl(getEnv('NEXT_PUBLIC_PRIVACY_URL'))
  const termsDomains = getHostnameFromUrl(getEnv('NEXT_PUBLIC_TERMS_URL'))

  const runtimeDirectives: CSPDirectives = {
    ...buildTimeCSPDirectives,

    'img-src': [...STATIC_IMG_SRC, ...brandLogoDomains, ...brandFaviconDomains],

    'connect-src': [
      ...STATIC_CONNECT_SRC,
      appUrl,
      ollamaUrl,
      socketUrl,
      socketWsUrl,
      ...brandLogoDomains,
      ...privacyDomains,
      ...termsDomains,
    ],
  }

  return buildCSPString(runtimeDirectives)
}

/**
 * Get the main CSP policy string (build-time)
 */
export function getMainCSPPolicy(): string {
  return buildCSPString(buildTimeCSPDirectives)
}

/**
 * Permissive CSP for workflow execution endpoints
 */
export function getWorkflowExecutionCSPPolicy(): string {
  return "default-src * 'unsafe-inline' 'unsafe-eval'; connect-src *;"
}

/**
 * Shared CSP for embeddable pages (chat, forms)
 * Allows embedding in iframes from any origin while maintaining other security policies
 */
function getEmbedCSPPolicy(): string {
  return buildCSPString({
    ...buildTimeCSPDirectives,
    'frame-ancestors': ['*'],
  })
}

/**
 * CSP for embeddable chat pages
 */
export function getChatEmbedCSPPolicy(): string {
  return getEmbedCSPPolicy()
}

/**
 * CSP for embeddable form pages
 */
export function getFormEmbedCSPPolicy(): string {
  return getEmbedCSPPolicy()
}

/**
 * Add a source to a specific directive (modifies build-time directives)
 */
export function addCSPSource(directive: keyof CSPDirectives, source: string): void {
  if (!buildTimeCSPDirectives[directive]) {
    buildTimeCSPDirectives[directive] = []
  }
  if (!buildTimeCSPDirectives[directive]!.includes(source)) {
    buildTimeCSPDirectives[directive]!.push(source)
  }
}

/**
 * Remove a source from a specific directive (modifies build-time directives)
 */
export function removeCSPSource(directive: keyof CSPDirectives, source: string): void {
  if (buildTimeCSPDirectives[directive]) {
    buildTimeCSPDirectives[directive] = buildTimeCSPDirectives[directive]!.filter(
      (s: string) => s !== source
    )
  }
}
