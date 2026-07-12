import { createMDX } from 'fumadocs-mdx/next'
import type { NextConfig } from 'next'

const withMDX = createMDX()

const config: NextConfig = {
  reactStrictMode: true,
  // Safe here since this repo's source is already fully public on GitHub -
  // no additional exposure versus Next's default (disabled to avoid leaking
  // source on the client).
  productionBrowserSourceMaps: true,
  transpilePackages: ['@sim/emcn', '@sim/workflow-renderer'],
  images: {
    unoptimized: true,
  },
  experimental: {
    webpackMemoryOptimizations: true,
    webpackBuildWorker: true,
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/introduction',
        permanent: true,
      },
      // building-agents/agents merged into the building-agents overview
      { source: '/building-agents/agents', destination: '/agents', permanent: true },
      // form deployment removed
      { source: '/deployment/form', destination: '/workflows/deployment', permanent: true },
      // copilot deprecated and removed
      { source: '/copilot', destination: '/mothership', permanent: true },
      { source: '/copilot/:path*', destination: '/mothership', permanent: true },
      // connections/* and variables/* collapsed into single pages under workflows/
      { source: '/connections', destination: '/workflows/connections', permanent: true },
      { source: '/connections/:path*', destination: '/workflows/connections', permanent: true },
      { source: '/variables', destination: '/workflows/variables', permanent: true },
      { source: '/variables/:path*', destination: '/workflows/variables', permanent: true },
      // capabilities/* renamed to building-agents/*
      { source: '/capabilities', destination: '/agents', permanent: true },
      { source: '/capabilities/agents', destination: '/agents', permanent: true },
      {
        source: '/capabilities/choosing',
        destination: '/agents/choosing',
        permanent: true,
      },
      // execution/* was broken up; redirect old URLs to their new homes
      { source: '/execution', destination: '/workflows', permanent: true },
      { source: '/execution/index', destination: '/workflows', permanent: true },
      { source: '/execution/basics', destination: '/workflows/how-it-runs', permanent: true },
      { source: '/execution/files', destination: '/files/passing-files', permanent: true },
      { source: '/execution/logging', destination: '/logs-debugging/logging', permanent: true },
      { source: '/execution/costs', destination: '/platform/costs', permanent: true },
      { source: '/execution/api', destination: '/api-reference/getting-started', permanent: true },
      {
        source: '/execution/api-deployment',
        destination: '/workflows/deployment/api',
        permanent: true,
      },
      { source: '/execution/chat', destination: '/workflows/deployment/chat', permanent: true },
      { source: '/execution/form', destination: '/deployment/form', permanent: true },
      {
        source: '/mcp/deploy-workflows',
        destination: '/workflows/deployment/mcp',
        permanent: true,
      },
      // building-agents section renamed to agents; mcp and skills folded into it
      { source: '/building-agents', destination: '/agents', permanent: true },
      { source: '/building-agents/:path*', destination: '/agents/:path*', permanent: true },
      { source: '/mcp', destination: '/agents/mcp', permanent: true },
      { source: '/skills', destination: '/agents/skills', permanent: true },
      // tools/ + triggers/<service> unified into per-service integrations/ pages.
      // Specific moves first (Next applies the first matching redirect):
      {
        source: '/tools/custom-tools',
        destination: '/agents/custom-tools',
        permanent: true,
      },
      { source: '/tools', destination: '/integrations', permanent: true },
      { source: '/tools/:slug', destination: '/integrations/:slug', permanent: true },
      // Old blocks/triggers index pages were folded into the workflows overview.
      // Native trigger pages (/triggers/start|schedule|webhook|rss|table) still exist.
      { source: '/blocks', destination: '/workflows#blocks', permanent: true },
      { source: '/triggers', destination: '/workflows#triggers', permanent: true },
      // Integration trigger pages: provider slug differs from the block type for a few.
      {
        source: '/triggers/jsm',
        destination: '/integrations/jira_service_management',
        permanent: true,
      },
      {
        source: '/triggers/google-calendar',
        destination: '/integrations/google_calendar',
        permanent: true,
      },
      {
        source: '/triggers/google-drive',
        destination: '/integrations/google_drive',
        permanent: true,
      },
      {
        source: '/triggers/google-sheets',
        destination: '/integrations/google_sheets',
        permanent: true,
      },
      {
        source: '/triggers/microsoft-teams',
        destination: '/integrations/microsoft_teams',
        permanent: true,
      },
      {
        source:
          '/triggers/:slug(airtable|ashby|attio|azure_devops|calcom|calendly|circleback|confluence|emailbison|fathom|fireflies|github|gmail|gong|google_forms|grain|greenhouse|hubspot|imap|intercom|jira|lemlist|linear|monday|notion|outlook|resend|salesforce|sendblue|servicenow|slack|stripe|telegram|twilio_voice|typeform|vercel|webflow|whatsapp|zoom)',
        destination: '/integrations/:slug',
        permanent: true,
      },
      // URL structure now mirrors the sidebar: sections own their pages.
      { source: '/blocks/:slug', destination: '/workflows/blocks/:slug', permanent: true },
      {
        source: '/triggers/:slug(start|schedule|webhook|rss|table|sim)',
        destination: '/workflows/triggers/:slug',
        permanent: true,
      },
      { source: '/deployment', destination: '/workflows/deployment', permanent: true },
      {
        source: '/deployment/:path*',
        destination: '/workflows/deployment/:path*',
        permanent: true,
      },
      { source: '/mailer', destination: '/mothership/mailer', permanent: true },
      { source: '/credentials', destination: '/platform/credentials', permanent: true },
      {
        source: '/credentials/:path*',
        destination: '/platform/credentials',
        permanent: true,
      },
      { source: '/permissions', destination: '/platform/permissions', permanent: true },
      {
        source: '/permissions/:path*',
        destination: '/platform/permissions',
        permanent: true,
      },
      { source: '/workspaces/fundamentals', destination: '/platform/workspaces', permanent: true },
      {
        source: '/workspaces/:slug(organization|permissions|credentials)',
        destination: '/platform/:slug',
        permanent: true,
      },
      { source: '/costs', destination: '/platform/costs', permanent: true },
      { source: '/self-hosting', destination: '/platform/self-hosting', permanent: true },
      {
        source: '/self-hosting/:path*',
        destination: '/platform/self-hosting/:path*',
        permanent: true,
      },
      { source: '/enterprise', destination: '/platform/enterprise', permanent: true },
      {
        source: '/enterprise/:path*',
        destination: '/platform/enterprise/:path*',
        permanent: true,
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/:path*.mdx',
        destination: '/llms.mdx/:path*',
      },
    ]
  },
}

export default withMDX(config)
