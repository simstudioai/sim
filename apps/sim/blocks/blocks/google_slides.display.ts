import { GoogleSlidesIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GoogleSlidesBlockDisplay = {
  type: 'google_slides',
  name: 'Google Slides (Legacy)',
  description: 'Read, write, and create presentations',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleSlidesIcon,
  longDescription:
    'Build, edit, and export branded Google Slides presentations end-to-end. Copy a template, replace text and image tokens, embed Sheets charts, style text and shapes with brand fonts and colors, manage tables and layouts, group elements, run atomic batch updates, and export to PDF or PPTX.',
  docsLink: 'https://docs.sim.ai/integrations/google_slides',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const GoogleSlidesV2BlockDisplay = {
  ...GoogleSlidesBlockDisplay,
  type: 'google_slides_v2',
  name: 'Google Slides',
  description: 'Read, write, and create presentations',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: false,
} satisfies BlockDisplay

export const GoogleSlidesBlockMeta = {
  tags: ['google-workspace', 'document-processing', 'content-management'],
  url: 'https://workspace.google.com/products/slides',
  templates: [
    {
      icon: GoogleSlidesIcon,
      title: 'Google Slides QBR generator',
      prompt:
        'Build a workflow that takes a customer account, pulls usage and support data, and generates a Google Slides QBR deck from a template with the metrics auto-filled.',
      modules: ['agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting'],
    },
    {
      icon: GoogleSlidesIcon,
      title: 'Google Slides weekly board update',
      prompt:
        'Create a scheduled weekly workflow that updates a Google Slides board deck with the latest KPIs from tables, swaps the cover image, and shares the link to the leadership thread.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['founder', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleSlidesIcon,
      title: 'Google Slides case-study builder',
      prompt:
        'Build a workflow that takes a customer story brief and generates a Google Slides case-study deck from a template, including pull quotes, metrics, and a logo.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
    {
      icon: GoogleSlidesIcon,
      title: 'Google Slides pitch personalizer',
      prompt:
        'Create a workflow that takes a Salesforce opportunity, generates a Google Slides pitch deck personalized to the account, and attaches it to the opportunity record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'content'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: GoogleSlidesIcon,
      title: 'Google Slides training builder',
      prompt:
        'Build a workflow that takes a knowledge base topic, generates a Google Slides training deck with structured slides, talking points, and quiz slides at the end.',
      modules: ['knowledge-base', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['hr', 'content'],
    },
    {
      icon: GoogleSlidesIcon,
      title: 'Google Slides exec metrics deck',
      prompt:
        'Create a scheduled monthly workflow that generates a Google Slides executive metrics deck from BigQuery and Stripe data, swaps the cover with the month, and shares it with leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['founder', 'reporting'],
      alsoIntegrations: ['google_bigquery', 'stripe'],
    },
    {
      icon: GoogleSlidesIcon,
      title: 'Google Slides win-loss recap',
      prompt:
        'Build a workflow that aggregates closed-won and closed-lost deals from Salesforce monthly, generates a Google Slides recap with patterns and insights, and emails it to the sales team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
      alsoIntegrations: ['salesforce', 'gmail'],
    },
  ],
  skills: [
    {
      name: 'generate-deck-from-template',
      description:
        'Copy a Google Slides template and replace placeholder text and images with data to produce a finished deck.',
      content:
        '# Generate Deck From Template\n\nProduce a finished presentation by copying a template deck and filling in dynamic values.\n\n## Steps\n1. Create a copy of the template presentation, or create a new presentation, and capture its presentationId.\n2. For each placeholder token (e.g. {{company}}, {{date}}, {{metric}}), call replace all text to substitute the real value across every slide.\n3. Replace placeholder images by adding images to the relevant slides, sizing and positioning them on the page.\n4. Add or duplicate slides for repeating sections (one per item) so the deck length matches the data.\n5. Read the presentation back to confirm every placeholder was resolved.\n\n## Output\nReturn the presentationId and the shareable link. Note any placeholders that had no matching data so they can be reviewed.',
    },
    {
      name: 'build-metrics-slide',
      description:
        'Add a slide with a table and shapes that summarizes KPIs or metrics into a Google Slides deck.',
      content:
        '# Build Metrics Slide\n\nInsert a clean, data-driven metrics slide into an existing presentation.\n\n## Steps\n1. Add a new slide to the target presentation and capture the new slide objectId.\n2. Create a table on the slide sized to the number of metrics (rows) and columns needed.\n3. Insert text into each cell with the metric name, current value, and change vs prior period.\n4. Optionally create shape callouts for headline numbers and apply text and paragraph styles for emphasis.\n5. Get a thumbnail to verify layout and readability.\n\n## Output\nReturn the slide objectId and a thumbnail link. Summarize which metrics were added.',
    },
    {
      name: 'extract-deck-content',
      description:
        'Read a Google Slides presentation and extract all slide text into a structured outline.',
      content:
        '# Extract Deck Content\n\nPull the full text of a presentation into a structured outline for summarization or repurposing.\n\n## Steps\n1. Read the presentation by ID to get all slides and page elements.\n2. For each slide, collect title text, body text, table cell text, and speaker notes if present.\n3. Preserve slide order and group text under each slide number.\n4. Skip purely decorative elements with no text.\n\n## Output\nReturn a numbered outline (one section per slide) with the extracted text. Useful as input for a summary, recap email, or knowledge base entry.',
    },
    {
      name: 'rebrand-deck',
      description:
        'Roll out a brand or naming change across an entire deck by swapping text and logo images everywhere.',
      content:
        '# Rebrand Deck\n\nApply a consistent brand or naming change across every slide in one pass.\n\n## Steps\n1. Read the presentation by ID to confirm which terms and logo placeholders appear.\n2. For each old-to-new term (product name, tagline, company name), call replace all text so it updates across every slide at once.\n3. Replace the old logo by calling replace all shapes with image, or replace image on each logo element, with the new asset URL.\n4. Optionally update shape or page properties to match new brand colors.\n5. Read the presentation back to confirm no stale terms or logos remain.\n\n## Output\nReturn the presentationId and a list of the terms and images that were replaced, flagging any old references that still appear.',
    },
  ],
} as const satisfies BlockMeta

export const GoogleSlidesV2BlockMeta = {
  tags: ['google-workspace', 'document-processing', 'content-management'],
  url: 'https://workspace.google.com/products/slides',
} as const satisfies BlockMeta
