import { env, getEnv } from '../config/env'
import { isDev, isHosted, isReactGrabEnabled } from '../config/feature-flags'

/**
 * Content Security Policy (CSP) configuration builder
 */

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
  'frame-src'?: string[]
  'frame-ancestors'?: string[]
  'form-action'?: string[]
  'base-uri'?: string[]
  'object-src'?: string[]
}

// Build-time CSP directives (for next.config.ts)
export const buildTimeCSPDirectives: CSPDirectives = {
  'default-src': ["'self'"],

  'script-src': [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    'https://*.google.com',
    'https://apis.google.com',
    'https://assets.onedollarstats.com',
    'https://challenges.cloudflare.com',
    ...(isReactGrabEnabled ? ['https://unpkg.com'] : []),
    ...(isHosted ? ['https://www.googletagmanager.com', 'https://www.google-analytics.com'] : []),
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
    'https://*.s3.amazonaws.com',
    'https://s3.amazonaws.com',
    'https://github.com/*',
    'https://collector.onedollarstats.com',
    ...(isHosted ? ['https://www.googletagmanager.com', 'https://www.google-analytics.com'] : []),
    ...(env.S3_BUCKET_NAME && env.AWS_REGION
      ? [`https://${env.S3_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com`]
      : []),
    ...(env.S3_KB_BUCKET_NAME && env.AWS_REGION
      ? [`https://${env.S3_KB_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com`]
      : []),
    ...(env.S3_CHAT_BUCKET_NAME && env.AWS_REGION
      ? [`https://${env.S3_CHAT_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com`]
      : []),
    'https://*.amazonaws.com',
    'https://*.blob.core.windows.net',
    'https://github.com/*',
    ...getHostnameFromUrl(env.NEXT_PUBLIC_BRAND_LOGO_URL),
    ...getHostnameFromUrl(env.NEXT_PUBLIC_BRAND_FAVICON_URL),
  ],

  'media-src': ["'self'", 'blob:'],

  'font-src': ["'self'", 'https://fonts.gstatic.com'],

  'connect-src': [
    "'self'",
    env.NEXT_PUBLIC_APP_URL || '',
    // Only include localhost fallbacks in development mode
    ...(env.OLLAMA_URL ? [env.OLLAMA_URL] : isDev ? ['http://localhost:11434'] : []),
    ...(env.NEXT_PUBLIC_SOCKET_URL
      ? [
          env.NEXT_PUBLIC_SOCKET_URL,
          env.NEXT_PUBLIC_SOCKET_URL.replace('http://', 'ws://').replace('https://', 'wss://'),
        ]
      : isDev
        ? ['http://localhost:3002', 'ws://localhost:3002']
        : []),
    'https://api.browser-use.com',
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
    'https://collector.onedollarstats.com',
    ...(isHosted
      ? [
          'https://www.googletagmanager.com',
          'https://*.google-analytics.com',
          'https://*.analytics.google.com',
        ]
      : []),
    ...getHostnameFromUrl(env.NEXT_PUBLIC_BRAND_LOGO_URL),
    ...getHostnameFromUrl(env.NEXT_PUBLIC_PRIVACY_URL),
    ...getHostnameFromUrl(env.NEXT_PUBLIC_TERMS_URL),
  ],

  'frame-src': [
    "'self'",
    'https://challenges.cloudflare.com',
    'https://drive.google.com',
    'https://docs.google.com',
    'https://*.google.com',
    ...(isHosted ? ['https://www.googletagmanager.com'] : []),
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
      const validSources = sources.filter((source: string) => source && source.trim() !== '')
      if (validSources.length === 0) return ''
      return `${directive} ${validSources.join(' ')}`
    })
    .filter(Boolean)
    .join('; ')
}

/**
 * Generate runtime CSP header with dynamic environment variables (safer approach)
 * This maintains compatibility with existing inline scripts while fixing Docker env var issues
 */
export function generateRuntimeCSP(): string {
  const appUrl = getEnv('NEXT_PUBLIC_APP_URL') || ''

  // Only include localhost URLs in development or when explicitly configured
  const socketUrl = getEnv('NEXT_PUBLIC_SOCKET_URL') || (isDev ? 'http://localhost:3002' : '')
  const socketWsUrl = socketUrl
    ? socketUrl.replace('http://', 'ws://').replace('https://', 'wss://')
    : isDev
      ? 'ws://localhost:3002'
      : ''
  const ollamaUrl = getEnv('OLLAMA_URL') || (isDev ? 'http://localhost:11434' : '')

  const brandLogoDomains = getHostnameFromUrl(getEnv('NEXT_PUBLIC_BRAND_LOGO_URL'))
  const brandFaviconDomains = getHostnameFromUrl(getEnv('NEXT_PUBLIC_BRAND_FAVICON_URL'))
  const privacyDomains = getHostnameFromUrl(getEnv('NEXT_PUBLIC_PRIVACY_URL'))
  const termsDomains = getHostnameFromUrl(getEnv('NEXT_PUBLIC_TERMS_URL'))

  const allDynamicDomains = [
    ...brandLogoDomains,
    ...brandFaviconDomains,
    ...privacyDomains,
    ...termsDomains,
  ]
  const uniqueDynamicDomains = Array.from(new Set(allDynamicDomains))
  const dynamicDomainsStr = uniqueDynamicDomains.join(' ')
  const brandLogoDomain = brandLogoDomains[0] || ''
  const brandFaviconDomain = brandFaviconDomains[0] || ''
  const reactGrabScript = isReactGrabEnabled ? 'https://unpkg.com' : ''
  const gtmScript = isHosted
    ? 'https://www.googletagmanager.com https://www.google-analytics.com'
    : ''
  const gtmConnect = isHosted
    ? 'https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com'
    : ''
  const gtmImg = isHosted ? 'https://www.googletagmanager.com https://www.google-analytics.com' : ''
  const gtmFrame = isHosted ? 'https://www.googletagmanager.com' : ''

  return `
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.google.com https://apis.google.com https://assets.onedollarstats.com https://challenges.cloudflare.com ${reactGrabScript} ${gtmScript};
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    img-src 'self' data: blob: https://*.googleusercontent.com https://*.google.com https://*.atlassian.com https://cdn.discordapp.com https://*.githubusercontent.com https://*.s3.amazonaws.com https://s3.amazonaws.com https://*.amazonaws.com https://*.blob.core.windows.net https://github.com/* https://collector.onedollarstats.com ${gtmImg} ${brandLogoDomain} ${brandFaviconDomain};
    media-src 'self' blob:;
    font-src 'self' https://fonts.gstatic.com;
    connect-src 'self' ${appUrl} ${ollamaUrl} ${socketUrl} ${socketWsUrl} https://api.browser-use.com https://api.exa.ai https://api.firecrawl.dev https://*.googleapis.com https://*.amazonaws.com https://*.s3.amazonaws.com https://*.blob.core.windows.net https://api.github.com https://github.com/* https://*.atlassian.com https://*.supabase.co https://challenges.cloudflare.com https://collector.onedollarstats.com ${gtmConnect} ${dynamicDomainsStr};
    frame-src 'self' https://challenges.cloudflare.com https://drive.google.com https://docs.google.com https://*.google.com ${gtmFrame};
    frame-ancestors 'self';
    form-action 'self';
    base-uri 'self';
    object-src 'none';
  `
    .replace(/\s{2,}/g, ' ')
    .trim()
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
