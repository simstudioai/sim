export interface WhitelabelConfig {
  // Branding
  appName: string
  appDescription: string
  companyName: string
  primaryColor: string
  secondaryColor: string
  
  // URLs and Domains
  appUrl: string
  docsUrl: string
  supportUrl: string
  
  // Social Media
  twitterHandle: string
  githubUrl: string
  discordUrl: string
  
  // Features
  enableTelemetry: boolean
  enableAnalytics: boolean
  enableMarketplace: boolean
  
  // Customization
  customLogoUrl?: string
  customFaviconUrl?: string
  customEmailTemplate?: string
}

export const whitelabelConfig: WhitelabelConfig = {
  appName: process.env.WHITELABEL_APP_NAME || '247 Workforce',
  appDescription: process.env.WHITELABEL_APP_DESCRIPTION || 'Build and deploy AI agents using our Figma-like canvas. Automate workflows and streamline your business processes with intelligent workforce automation.',
  companyName: process.env.WHITELABEL_COMPANY_NAME || '247 Workforce',
  primaryColor: process.env.WHITELABEL_PRIMARY_COLOR || '#701FFC',
  secondaryColor: process.env.WHITELABEL_SECONDARY_COLOR || '#802FFF',
  
  appUrl: process.env.WHITELABEL_APP_URL || 'https://247workforce.com',
  docsUrl: process.env.WHITELABEL_DOCS_URL || 'https://docs.247workforce.com',
  supportUrl: process.env.WHITELABEL_SUPPORT_URL || 'https://247workforce.com/support',
  
  twitterHandle: process.env.WHITELABEL_TWITTER_HANDLE || '@247workforce',
  githubUrl: process.env.WHITELABEL_GITHUB_URL || 'https://github.com/247workforce/workforce',
  discordUrl: process.env.WHITELABEL_DISCORD_URL || 'https://discord.gg/247workforce',
  
  enableTelemetry: process.env.WHITELABEL_ENABLE_TELEMETRY !== 'false',
  enableAnalytics: process.env.WHITELABEL_ENABLE_ANALYTICS !== 'false',
  enableMarketplace: process.env.WHITELABEL_ENABLE_MARKETPLACE !== 'false',
  
  customLogoUrl: process.env.WHITELABEL_CUSTOM_LOGO_URL,
  customFaviconUrl: process.env.WHITELABEL_CUSTOM_FAVICON_URL,
  customEmailTemplate: process.env.WHITELABEL_CUSTOM_EMAIL_TEMPLATE,
} 