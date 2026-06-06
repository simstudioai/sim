import { createMDX } from 'fumadocs-mdx/next'
import type { NextConfig } from 'next'

const withMDX = createMDX()

const config: NextConfig = {
  reactStrictMode: true,
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
      { source: '/building-agents/agents', destination: '/building-agents', permanent: true },
      // form deployment removed
      { source: '/deployment/form', destination: '/deployment', permanent: true },
      // copilot deprecated and removed
      { source: '/copilot', destination: '/mothership', permanent: true },
      { source: '/copilot/:path*', destination: '/mothership', permanent: true },
      // connections/* and variables/* collapsed into single pages under workflows/
      { source: '/connections', destination: '/workflows/connections', permanent: true },
      { source: '/connections/:path*', destination: '/workflows/connections', permanent: true },
      { source: '/variables', destination: '/workflows/variables', permanent: true },
      { source: '/variables/:path*', destination: '/workflows/variables', permanent: true },
      // capabilities/* renamed to building-agents/*
      { source: '/capabilities', destination: '/building-agents', permanent: true },
      { source: '/capabilities/agents', destination: '/building-agents/agents', permanent: true },
      {
        source: '/capabilities/choosing',
        destination: '/building-agents/choosing',
        permanent: true,
      },
      // execution/* was broken up; redirect old URLs to their new homes
      { source: '/execution', destination: '/workflows', permanent: true },
      { source: '/execution/index', destination: '/workflows', permanent: true },
      { source: '/execution/basics', destination: '/workflows/how-it-runs', permanent: true },
      { source: '/execution/files', destination: '/files/passing-files', permanent: true },
      { source: '/execution/logging', destination: '/logs-debugging/logging', permanent: true },
      { source: '/execution/costs', destination: '/costs', permanent: true },
      { source: '/execution/api', destination: '/api-reference/getting-started', permanent: true },
      { source: '/execution/api-deployment', destination: '/deployment/api', permanent: true },
      { source: '/execution/chat', destination: '/deployment/chat', permanent: true },
      { source: '/execution/form', destination: '/deployment/form', permanent: true },
      { source: '/mcp/deploy-workflows', destination: '/deployment/mcp', permanent: true },
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
