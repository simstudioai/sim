// Shared types for the integrations section of the landing site.
// Mirrors the shape written by scripts/generate-docs.ts → writeIntegrationsJson().

export interface IntegrationInstallStep {
  title: string
  body: string
}

export interface IntegrationLandingContent {
  /**
   * Install walkthrough for OAuth apps whose connection lives behind sign-in.
   * Provides the "Add to {app}" instructions that app marketplaces require
   * when the install button sits behind a login.
   */
  install?: {
    heading: string
    intro: string
    steps: IntegrationInstallStep[]
  }
  /** Short data-handling summary shown next to a privacy-policy link. */
  privacy?: {
    body: string
    href: string
  }
  /**
   * Disclaimer about AI-generated content, required by some marketplaces for
   * apps with an AI component (e.g. Slack's AI-components guideline).
   */
  aiDisclaimer?: string
}

/**
 * Hand-authored, per-integration SEO/GEO overrides keyed by slug. Unlike
 * {@link IntegrationLandingContent}, this is consumed at render time directly by
 * the integration page (`integrations/(shell)/[slug]/page.tsx`) and is NOT baked
 * into `integrations.json` - it never touches the build/generation pipeline.
 *
 * Every field is optional: when absent, the page falls back to its generated
 * default (the bare integration name for the H1, the auto-built title/meta, the
 * block's `longDescription` for the overview, etc.). Provide only the fields a
 * given integration needs to tune.
 */
export interface IntegrationSeoContent {
  /** Absolute `<title>` rendered verbatim (e.g. `GitHub Workflow Automation | Sim`). */
  title?: string
  /** Meta description (≤160 chars), overriding the generated one. */
  description?: string
  /** Focus keywords, replacing the generated keyword list when present. */
  keywords?: string[]
  /** Visible `<h1>` text, overriding the bare integration name. */
  h1?: string
  /** Short keyword-rich tagline under the H1, overriding the default short description. */
  tagline?: string
  /** Overview-section body prose, overriding the generated `longDescription`. */
  overview?: string
  /** Real-time-triggers intro paragraph, overriding the generated default. */
  triggersIntro?: string
  /** Agent-templates intro paragraph, overriding the generated default. */
  templatesIntro?: string
  /**
   * Text appended to the `"{n} {name} tool(s) available in Sim"` subtitle (e.g.
   * `" for Confluence automation across pages, blog posts, …"`). Keeps the tool
   * count dynamic while letting authors extend the line with keyword context.
   */
  toolsSubtitleSuffix?: string
}
