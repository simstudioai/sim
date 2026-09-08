import path from 'node:path'
import type { NextConfig } from 'next'
import { env, isTruthy } from './lib/core/config/env'
import { isDev } from './lib/core/config/env-flags'
import {
  getChatEmbedCSPPolicy,
  getMainCSPPolicy,
  getWorkflowExecutionCSPPolicy,
} from './lib/core/security/csp'
import { LANDING_ROUTES } from './lib/landing/routes'

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // Safe here since this repo's source is already fully public on GitHub -
  // no additional exposure versus Next's default (disabled to avoid leaking
  // source on the client).
  productionBrowserSourceMaps: true,
  turbopack: {
    root: path.join(import.meta.dirname, '../..'),
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    /**
     * Allowed `quality` values for next/image. 75 is the app-wide default;
     * 90 exists for large photographic marketing assets (the landing hero
     * backdrop) where the default visibly softens texture.
     */
    qualities: [75, 90],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'api.stability.ai',
      },
      // Azure Blob Storage
      {
        protocol: 'https',
        hostname: '*.blob.core.windows.net',
      },
      // AWS S3
      {
        protocol: 'https',
        hostname: '*.s3.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: '*.s3.*.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      // Brand logo domain if configured
      ...(process.env.NEXT_PUBLIC_BRAND_LOGO_URL
        ? (() => {
            try {
              return [
                {
                  protocol: 'https' as const,
                  hostname: new URL(process.env.NEXT_PUBLIC_BRAND_LOGO_URL!).hostname,
                },
              ]
            } catch {
              return []
            }
          })()
        : []),
      // Brand favicon domain if configured
      ...(process.env.NEXT_PUBLIC_BRAND_FAVICON_URL
        ? (() => {
            try {
              return [
                {
                  protocol: 'https' as const,
                  hostname: new URL(process.env.NEXT_PUBLIC_BRAND_FAVICON_URL!).hostname,
                },
              ]
            } catch {
              return []
            }
          })()
        : []),
    ],
  },
  typescript: {
    ignoreBuildErrors: isTruthy(env.DOCKER_BUILD),
  },
  output: isTruthy(env.DOCKER_BUILD) ? 'standalone' : undefined,
  serverExternalPackages: [
    '@1password/sdk',
    'ws',
    'isolated-vm',
    '@e2b/code-interpreter',
    'e2b',
    '@daytona/sdk',
    '@earendil-works/pi-ai',
    '@earendil-works/pi-coding-agent',
    /**
     * Keep PDF.js and its native canvas implementation intact. The shared server
     * loader initializes canvas primitives before PDF.js evaluates its module.
     */
    'pdfjs-dist',
    '@napi-rs/canvas',
    // The collab-doc seed converter lazily `require`s jsdom for a headless TipTap editor. Keep it
    // external so webpack doesn't try to bundle jsdom's dynamic internal requires.
    'jsdom',
    // The collab-doc converter runs TipTap + Yjs headlessly server-side. Two reasons these must be
    // external (native Node require), not bundled: (1) the server bundler gives bundled TipTap a
    // `window` that does NOT read `globalThis`, so `elementFromString` throws "no window object" even
    // after the converter installs a jsdom window; (2) bundling would load a SECOND copy of `yjs`, so
    // `@tiptap/y-tiptap`'s `item instanceof Y.XmlElement` checks — against the external `yjs` — would
    // fail on nodes the app created with the bundled `yjs` ("Unexpected case"). One external copy fixes
    // both. Server-only — the client editor bundles its own copies for the browser.
    'yjs',
    'y-protocols',
    'lib0',
    '@tiptap/core',
    '@tiptap/pm',
    '@tiptap/markdown',
    '@tiptap/y-tiptap',
    '@tiptap/starter-kit',
    '@tiptap/extension-code',
    '@tiptap/extension-code-block',
    '@tiptap/extension-image',
    '@tiptap/extension-list',
    '@tiptap/extension-paragraph',
    '@tiptap/extension-table',
    '@tiptap/extension-highlight',
  ],
  outputFileTracingIncludes: {
    // The seed, merge, and persist endpoints all lazily `require('jsdom')` (via the collab-doc
    // converter), which is invisible to the standalone file tracer, so force jsdom (and its transitive
    // deps, followed from its static requires) into the trace — otherwise a Docker/standalone build
    // omits it and the endpoint 500s with MODULE_NOT_FOUND. (The Yjs external stack — yjs/lib0/
    // y-protocols — is copied whole in docker/app.Dockerfile: its glob would resolve against apps/sim
    // but those deps hoist to the monorepo root, so a trace include can't reach them.)
    '/api/internal/file-doc/seed': ['./node_modules/jsdom/**/*'],
    '/api/internal/file-doc/merge': ['./node_modules/jsdom/**/*'],
    '/api/internal/file-doc/persist': ['./node_modules/jsdom/**/*'],
    /**
     * No `sharp`/`@img` entries: these globs resolve against apps/sim while both hoist to the
     * monorepo root, so they matched nothing. docker/app.Dockerfile copies them instead.
     */
    '/*': ['./lib/execution/sandbox/bundles/*.cjs', './node_modules/ws/**/*'],
  },
  experimental: {
    /**
     * Turbopack's dev filesystem cache stays ON (this is also the Next default
     * since v16.1). It is what makes a dev-server restart cheap: without it every
     * restart recompiles the route graph from scratch.
     *
     * Measured locally on `/workspace/[workspaceId]/w`, n=3 per cell, restarting
     * the dev server between each run:
     *
     *   cache OFF   31.4s / 30.1s / 31.9s   RSS ~9.0-9.8 GB
     *   cache ON     5.7s /  6.1s /  5.7s   RSS ~4.8-5.1 GB
     *
     * 5.4x faster restarts and ~1.9x less memory. Cold compile with an empty
     * cache is unchanged (~32s either way) — the cache only pays back on restart.
     *
     * This is deliberately NOT the same decision as `turbopackFileSystemCacheForBuild`
     * below. That one is measured-harmful for `next build`; this one is
     * measured-beneficial for `next dev`. It was previously `false`, but that was
     * incidental — it was introduced by a landing-page redesign (#5408) whose
     * description never mentions Turbopack, caching, or dev performance, and it
     * is not covered by the #6078 build A/B cited below.
     *
     * The cache is unbounded on disk (an abandoned one reached 78 GB here), so
     * `scripts/prune-turbopack-cache.ts` is chained into every `dev` script to cap it.
     * A *corrupted* cache can abort Turbopack outright ("Cache corruption
     * detected: checksum mismatch") rather than falling back — it depends whether
     * the damaged region is read. `bun run dev:clean` and restart is the fix.
     *
     * If you re-measure any of this: `next dev` compiles routes on demand, so
     * startup time means nothing — time the first request to a route, restart the
     * server between runs, and stop it with SIGINT. A `kill -9` mid-write makes
     * Turbopack discard the partially-written cache and rebuild silently, which
     * reads as "the cache does nothing" and is how this flag stayed wrong.
     */
    turbopackFileSystemCacheForDev: true,
    /**
     * Turbopack's persistent build cache (beta) stays off — it is a net loss at
     * this app's size. A controlled A/B on a byte-identical module graph (PR
     * #6078) measured compile at 113s with it off, 162s cold with it on, and 360s
     * warm: the cache made the same build 3.2x slower. It also grew 5.1 GB ->
     * 12 GB across two runs of an unchanged tree, so a cache degrades the longer
     * it lives. Restoring across commits is separately undocumented-as-supported
     * (vercel/next.js#87283 reports stale HTML from a cache built elsewhere).
     *
     * The explicit pin is load-bearing: 16.3.0 flipped this default to true for
     * stable (vercel/next.js#94616), so dropping it re-enables the slower cache.
     */
    turbopackFileSystemCacheForBuild: false,
    /**
     * TypeScript 7 ships no JavaScript compiler API until 7.1, so Next's default
     * checker cannot load it — this shells out to the project-local `tsc` instead.
     * Pinned because the failure mode is not slower type checking but none at all:
     * 16.2.12 skipped the stage silently in 138ms.
     */
    useTypeScriptCli: true,
    preloadEntriesOnStart: false,
    /**
     * Under Turbopack this is not a no-op: the list feeds
     * `side_effect_free_packages` and is force-appended to `transpiledPackages`,
     * which also removes each entry from the server externals set. Entries here
     * must be real barrel packages that are actually imported - a stale entry
     * costs transform work and overrides that package's own `sideEffects`
     * declaration.
     */
    optimizePackageImports: [
      'framer-motion',
      '@xyflow/react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-switch',
      '@radix-ui/react-slider',
      'streamdown',
      'zod',
    ],
  },
  ...(isDev && {
    allowedDevOrigins: [
      ...(env.NEXT_PUBLIC_APP_URL
        ? (() => {
            try {
              return [new URL(env.NEXT_PUBLIC_APP_URL).host]
            } catch {
              return []
            }
          })()
        : []),
      'localhost:3000',
      'localhost:3001',
      '127.0.0.1',
      '127.0.0.1:3011',
      '127.0.0.1:3012',
    ],
  }),
  transpilePackages: [
    '@react-email/components',
    '@react-email/render',
    '@t3-oss/env-nextjs',
    '@t3-oss/env-core',
    '@sim/db',
    '@sim/emcn',
    '@sim/workflow-renderer',
  ],
  async headers() {
    return [
      {
        // `/public`-served assets keep their path across deploys (no content
        // hash), so a shorter TTL + revalidation window bounds how long a
        // changed asset can serve stale.
        source:
          '/((?!api/|_next/static/).*\\.(?:svg|jpg|jpeg|png|gif|ico|webp|avif|woff|woff2|ttf|eot))',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/.well-known/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Accept' },
        ],
      },
      // /api/* CORS is set at runtime in proxy.ts (resolveApiCorsPolicy).
      {
        source: '/api/workflows/:id/execute',
        headers: [
          { key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' },
          { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
          {
            key: 'Content-Security-Policy',
            value: getWorkflowExecutionCSPPolicy(),
          },
        ],
      },
      {
        source: '/api/v2/workflows/:workflowId/execute',
        headers: [
          { key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' },
          { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
          {
            key: 'Content-Security-Policy',
            value: getWorkflowExecutionCSPPolicy(),
          },
        ],
      },
      {
        // Exclude Vercel internal resources and static assets from strict COOP, Google Drive Picker
        // and the /demo Cal.com booking embed to prevent 'refused to connect' / slow-load issues.
        // The pages an OAuth popup can land on are excluded too: `same-origin` would disown the
        // popup from its opener, leaving it not reliably script-closable and reporting `closed`
        // for a live window.
        source:
          '/((?!_next|_vercel|api|favicon.ico|w/.*|workspace|api/tools/drive|demo|oauth-error|oauth/chat-complete).*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
      {
        // COEP stays on by default - a new route is cross-origin isolated unless
        // it is named here. The exemptions are the app surfaces that embed
        // credentialed third parties (Drive Picker, Vercel resources) and the
        // marketing surface, which must opt out wholesale: see LANDING_ROUTES.
        // The trailing `|$` exempts the root path.
        source: `/((?!_next|_vercel|api|favicon.ico|w/.*|workspace/.*|api/tools/drive|${LANDING_ROUTES.join('|')}|$).*)`,
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
        ],
      },
      {
        // For main app routes, Google Drive Picker, the /demo Cal.com embed, the OAuth popup pages,
        // and Vercel resources - use permissive policies. The popup pages match their opener's
        // value so the two stay in one browsing-context group.
        source:
          '/(w/.*|workspace.*|api/tools/drive|demo.*|oauth-error|oauth/chat-complete|_next/.*|_vercel/.*)',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'unsafe-none',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
        ],
      },
      // Keeps sourcemap files out of search indexes. This does NOT block
      // access to them - `productionBrowserSourceMaps` is on and the `.map`
      // files ship publicly in the production image; nothing here restricts
      // who can fetch one. The trailing
      // `$` this rule previously ended with is not a regex anchor in Next's
      // `source` matcher (path-to-regexp syntax, not raw regex) - it matched
      // a literal `$` character, so this rule never actually fired against
      // real `.map` URLs. Next already anchors the compiled pattern at both
      // ends, so no trailing anchor is needed here.
      //
      // Also bounds `.map` files to a short, revalidated TTL rather than
      // Next's built-in 1yr immutable default for `_next/static/*` - maps
      // are content-hashed like their JS, so this isn't about staleness,
      // it's so a future decision to stop shipping `productionBrowserSourceMaps`
      // isn't undermined by browsers/edges holding old maps for a year.
      {
        source: '/(.*)\\.map',
        headers: [
          {
            key: 'x-robots-tag',
            value: 'noindex',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      // Chat pages - allow iframe embedding from any origin
      {
        source: '/chat/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // No X-Frame-Options to allow iframe embedding
          {
            key: 'Content-Security-Policy',
            value: getChatEmbedCSPPolicy(),
          },
          // Permissive CORS for chat requests from embedded chats
          { key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' },
          { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
        ],
      },
      // Apply security headers to routes not handled by middleware runtime CSP
      // Middleware handles: /, /login, /signup, /workspace/*
      // Exclude chat routes which have their own permissive embed headers
      {
        source: '/((?!workspace|chat|login|signup|$).*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Content-Security-Policy',
            value: getMainCSPPolicy(),
          },
        ],
      },
    ]
  },
  async redirects() {
    const redirects = []

    // Social link redirects (used in emails to avoid spam filter issues)
    redirects.push(
      {
        source: '/discord',
        destination: 'https://discord.gg/Hr4UWYEcTT',
        permanent: false,
      },
      {
        source: '/slack',
        destination:
          'https://join.slack.com/t/sim-ott9864/shared_invite/zt-43lp8tc5v-0qrrqHGBKUsvQlpoouH~TA',
        permanent: false,
      },
      {
        source: '/x',
        destination: 'https://x.com/simdotai',
        permanent: false,
      },
      {
        source: '/linkedin',
        destination: 'https://www.linkedin.com/company/simstudioai/',
        permanent: false,
      },
      {
        source: '/github',
        destination: 'https://github.com/simstudioai/sim',
        permanent: false,
      },
      {
        source: '/team',
        destination: 'https://cal.com/team/sim/demo',
        permanent: false,
      }
    )

    // Redirect /building and /studio to /blog (legacy URL support)
    redirects.push(
      {
        source: '/building/:path*',
        destination: 'https://www.sim.ai/blog/:path*',
        permanent: true,
      },
      {
        source: '/studio/:path*',
        destination: 'https://www.sim.ai/blog/:path*',
        permanent: true,
      }
    )

    // The scheduled-tasks marketing page is retired with the feature. The URL is
    // indexed, so send it to the surface that still carries scheduled execution
    // (the workflow Schedule trigger) instead of letting it 404.
    redirects.push({
      source: '/scheduled-tasks',
      destination: '/workflows',
      permanent: true,
    })

    /**
     * The marketing Academy course/lesson pages were removed; content is
     * consolidated into the docs site instead. Old course/lesson slugs have
     * no equivalent path there, so every sub-path collapses to the new
     * landing page rather than forwarding to a path that may not exist.
     */
    redirects.push({
      source: '/academy/:path*',
      destination: 'https://docs.sim.ai/academy',
      permanent: true,
    })

    // Move root feeds to blog namespace
    redirects.push(
      {
        source: '/rss.xml',
        destination: '/blog/rss.xml',
        permanent: true,
      },
      {
        source: '/sitemap-images.xml',
        destination: '/blog/sitemap-images.xml',
        permanent: true,
      }
    )

    // Legacy chat URL support: the workspace chat route was renamed from
    // `/workspace/:workspaceId/task/:chatId` to `/workspace/:workspaceId/chat/:chatId`.
    // Preserve existing bookmarks and deeplinks.
    redirects.push({
      source: '/workspace/:workspaceId/task/:chatId',
      destination: '/workspace/:workspaceId/chat/:chatId',
      permanent: true,
    })

    // Legacy integration slug: the incident.io block's display name was fixed
    // from `incidentio` to `incident.io`, which moved its catalog slug.
    // Preserve the previously indexed landing URL.
    redirects.push({
      source: '/integrations/incidentio',
      destination: '/integrations/incident-io',
      permanent: true,
    })

    /**
     * Legacy integration slug: the SAP block's display name was fixed from
     * `SAP S/4HANA` to `SAP S4HANA`, which moved its catalog slug. Preserves
     * the previously indexed landing URL.
     */
    redirects.push({
      source: '/integrations/sap-s-4hana',
      destination: '/integrations/sap-s4hana',
      permanent: true,
    })

    /**
     * Legacy integration slug: the Cal.com block's display name briefly
     * shipped as `CalCom` before being fixed to `Cal Com`/`Cal.com`, which
     * moved its catalog slug from `calcom` to `cal-com`.
     */
    redirects.push({
      source: '/integrations/calcom',
      destination: '/integrations/cal-com',
      permanent: true,
    })

    /**
     * The partner program page was removed; routes existing links/bookmarks
     * to contact instead of leaving a dead, previously-indexed URL.
     */
    redirects.push({
      source: '/partners',
      destination: '/contact',
      permanent: true,
    })

    /**
     * AEO/GEO-style posts (listicles, comparisons, how-tos) were split out of
     * `/blog` into the dedicated `/library` section so `/blog` stays
     * editorial-only. Preserve previously indexed URLs for the moved posts.
     */
    for (const slug of [
      'best-zapier-alternatives',
      'ai-agents-vs-rpa',
      'ai-agent-vs-chatbot',
      'openai-vs-n8n-vs-sim',
      'ai-agent-ideas',
      'how-to-create-an-ai-agent',
    ]) {
      redirects.push({
        source: `/blog/${slug}`,
        destination: `/library/${slug}`,
        permanent: true,
      })
    }

    /**
     * The comparison route was renamed from `/comparison` to `/comparisons`
     * for naming consistency with `/integrations/[slug]` (plural category,
     * singular item). Preserve previously indexed URLs for the hub page and
     * every competitor detail page.
     */
    redirects.push(
      {
        source: '/comparison',
        destination: '/comparisons',
        permanent: true,
      },
      {
        source: '/comparison/:path*',
        destination: '/comparisons/:path*',
        permanent: true,
      }
    )

    /**
     * Stray crawler/artifact URLs picked up in an external SEO audit — no
     * page ever existed at these paths, but they were indexed or linked
     * somewhere with junk characters/casing. Send them home instead of 404.
     */
    redirects.push(
      {
        source: '/$',
        destination: '/',
        permanent: true,
      },
      {
        source: '/&',
        destination: '/',
        permanent: true,
      },
      {
        source: '/Sim',
        destination: '/',
        permanent: true,
      },
      {
        source: '/homepage',
        destination: '/',
        permanent: true,
      },
      {
        source: '/logo',
        destination: '/',
        permanent: true,
      },
      {
        source: '/en-US',
        destination: '/',
        permanent: true,
      }
    )

    /**
     * Indexed 404s from an external SEO audit. The capability paths read as
     * tool/feature pages and map to the integrations catalog; the rest have no
     * closer successor than the homepage.
     *
     * `/security` is deliberately excluded: security.txt advertises it as the
     * RFC 9116 `Policy` URI, so a permanent redirect to marketing would both
     * mislead that link and shadow a real policy page added later.
     */
    redirects.push(
      ...['read', 'research', 'scrape'].map((slug) => ({
        source: `/${slug}`,
        destination: '/integrations',
        permanent: true,
      })),
      ...['actions', 'crawl', 'fast'].map((slug) => ({
        source: `/${slug}`,
        destination: '/',
        permanent: true,
      }))
    )

    return redirects
  },
  async rewrites() {
    return [
      {
        source: '/favicon.ico',
        destination: '/icon.svg',
      },
      {
        source: '/r/:shortCode',
        destination: 'https://go.trybeluga.ai/:shortCode',
      },
    ]
  },
}

export default nextConfig
