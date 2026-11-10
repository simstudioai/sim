import { CaptureKitIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'

export const CaptureKitBlock: BlockConfig = {
  type: 'capturekit',
  name: 'CaptureKit',
  description: 'Capture screenshots and extract content from web pages',
  authMode: AuthMode.ApiKey,
  longDescription:
    "Capture any web page as a PNG, JPEG, WebP image or a PDF, by viewport, full page or CSS selector on 17+ emulated devices; extract a page's metadata, links and Markdown; fetch raw HTML; and get an AI summary of what a website offers.",
  docsLink: 'https://docs.sim.ai/integrations/capturekit',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#FFFFFF',
  icon: CaptureKitIcon,
  canvasPresentation: {
    defaultTitle: 'CaptureKit',
    sentences: {
      byOperation: {
        screenshot: [
          { text: 'Take a screenshot of', field: 'url', core: true },
          { text: 'as', field: 'format' },
        ],
        extract_content: [{ text: 'Extract the content of', field: 'url', core: true }],
        fetch_html: [{ text: 'Fetch the HTML of', field: 'url', core: true }],
        analyze_website: [{ text: 'Analyze the website', field: 'url', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Take Screenshot', id: 'screenshot' },
        { label: 'Extract Content', id: 'extract_content' },
        { label: 'Fetch HTML', id: 'fetch_html' },
        { label: 'Analyze Website', id: 'analyze_website' },
      ],
      value: () => 'screenshot',
    },
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      placeholder: 'https://example.com',
      required: true,
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'PNG', id: 'png' },
        { label: 'JPEG', id: 'jpeg' },
        { label: 'WebP', id: 'webp' },
        { label: 'PDF', id: 'pdf' },
      ],
      value: () => 'png',
      condition: { field: 'operation', value: 'screenshot' },
    },
    {
      id: 'fullPage',
      title: 'Full Page',
      type: 'switch',
      condition: { field: 'operation', value: 'screenshot' },
    },
    {
      id: 'device',
      title: 'Device',
      type: 'dropdown',
      options: [
        { label: 'iPhone 14 Pro', id: 'iphone_14_pro' },
        { label: 'iPhone 14 Pro Max', id: 'iphone_14_pro_max' },
        { label: 'iPhone 13 Pro Max', id: 'iphone_13_pro_max' },
        { label: 'iPhone 13 mini', id: 'iphone_13_mini' },
        { label: 'iPhone 12', id: 'iphone_12' },
        { label: 'iPhone X', id: 'iphone_x' },
        { label: 'iPad', id: 'ipad' },
        { label: 'Pixel 7 Pro', id: 'pixel_7_pro' },
        { label: 'Pixel 6a', id: 'pixel_6a' },
        { label: 'Pixel 5', id: 'pixel_5' },
        { label: 'Galaxy S23 Ultra', id: 'galaxy_s23_ultra' },
        { label: 'Galaxy S23', id: 'galaxy_s23' },
        { label: 'Galaxy S8', id: 'galaxy_s8' },
        { label: 'Galaxy Fold4', id: 'galaxy_fold4' },
        { label: 'Huawei Mate 50 Pro', id: 'huawei_mate_50_pro' },
        { label: 'Huawei P60 Pro', id: 'huawei_p60_pro' },
        { label: 'Redmi Note 12 Pro', id: 'redmi_note_12_pro' },
        { label: 'Redmi Note 11', id: 'redmi_note_11' },
      ],
      condition: { field: 'operation', value: 'screenshot' },
      mode: 'advanced',
    },
    {
      id: 'selector',
      title: 'Element Selector',
      type: 'short-input',
      placeholder: '#pricing',
      condition: { field: 'operation', value: 'screenshot' },
      mode: 'advanced',
    },
    {
      id: 'viewportWidth',
      title: 'Viewport Width',
      type: 'short-input',
      placeholder: 'Defaults to 1280',
      condition: { field: 'operation', value: 'screenshot' },
      mode: 'advanced',
    },
    {
      id: 'viewportHeight',
      title: 'Viewport Height',
      type: 'short-input',
      placeholder: 'Defaults to 1024',
      condition: { field: 'operation', value: 'screenshot' },
      mode: 'advanced',
    },
    {
      id: 'delay',
      title: 'Delay',
      type: 'short-input',
      placeholder: 'Defaults to 0',
      condition: { field: 'operation', value: 'screenshot' },
      mode: 'advanced',
    },
    {
      id: 'removeCookieBanners',
      title: 'Remove Cookie Banners',
      type: 'switch',
      condition: { field: 'operation', value: ['screenshot', 'extract_content'] },
      mode: 'advanced',
    },
    {
      id: 'removeAds',
      title: 'Remove Ads',
      type: 'switch',
      condition: { field: 'operation', value: ['screenshot', 'extract_content'] },
      mode: 'advanced',
    },
    {
      id: 'includeMarkdown',
      title: 'Include Markdown',
      type: 'switch',
      condition: { field: 'operation', value: 'extract_content' },
    },
    {
      id: 'customPrompt',
      title: 'Instructions',
      type: 'short-input',
      placeholder: 'Focus on pricing',
      condition: { field: 'operation', value: 'analyze_website' },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your CaptureKit API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'capturekit_screenshot',
      'capturekit_extract_content',
      'capturekit_fetch_html',
      'capturekit_analyze_website',
    ],
    config: {
      tool: (params) => `capturekit_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.operation === 'screenshot') {
          result.viewportWidth = parseOptionalNumberInput(params.viewportWidth, 'Viewport Width', {
            integer: true,
            min: 1,
          })
        }
        if (params.operation === 'screenshot') {
          result.viewportHeight = parseOptionalNumberInput(
            params.viewportHeight,
            'Viewport Height',
            { integer: true, min: 1 }
          )
        }
        if (params.operation === 'screenshot') {
          result.delay = parseOptionalNumberInput(params.delay, 'Delay', { min: 0 })
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    url: { type: 'string', description: 'URL of the page (e.g., "https://example.com")' },
    format: {
      type: 'string',
      description: 'Output format: png, jpeg, webp or pdf (defaults to "png")',
    },
    fullPage: {
      type: 'boolean',
      description: 'Capture the entire page instead of the visible viewport',
    },
    device: { type: 'string', description: 'Device to emulate (e.g., "iphone_14_pro")' },
    selector: {
      type: 'string',
      description: 'CSS selector of one element to capture (e.g., "#pricing")',
    },
    viewportWidth: {
      type: 'number',
      description: 'Width of the browser viewport in pixels (defaults to 1280)',
    },
    viewportHeight: {
      type: 'number',
      description: 'Height of the browser viewport in pixels (defaults to 1024)',
    },
    delay: { type: 'number', description: 'Seconds to wait before capturing (defaults to 0)' },
    removeCookieBanners: { type: 'boolean', description: 'Remove cookie banners before capturing' },
    removeAds: { type: 'boolean', description: 'Remove ads before capturing' },
    includeMarkdown: { type: 'boolean', description: 'Include the page content as Markdown' },
    customPrompt: {
      type: 'string',
      description: 'Extra instructions for the analysis (e.g., "Focus on pricing")',
    },
    apiKey: { type: 'string', description: 'CaptureKit API key' },
  },
  outputs: {
    file: {
      type: 'file',
      description: 'Screenshot or PDF of the page, stored in the execution files',
    },
    metadata: { type: 'json', description: 'Page metadata' },
    links: { type: 'json', description: 'Links found on the page' },
    markdown: { type: 'string', description: 'Page content as Markdown, when requested' },
    html: { type: 'string', description: 'Raw HTML of the page' },
    summary: { type: 'string', description: 'Summary of what the website offers' },
    valueProposition: { type: 'string', description: 'Value proposition of the website' },
    businessType: { type: 'string', description: 'Type of business' },
    targetAudience: { type: 'string', description: 'Audience the website addresses' },
    callToAction: { type: 'string', description: 'Main call to action of the website' },
    keyFeatures: { type: 'json', description: 'Key features of the product or service' },
    categories: { type: 'json', description: 'Categories of the website' },
    useCases: { type: 'json', description: 'Use cases the website describes' },
    emails: { type: 'json', description: 'Email addresses found on the website' },
    phoneNumbers: { type: 'json', description: 'Phone numbers found on the website' },
  },
}

export const CaptureKitBlockMeta = {
  tags: ['web-scraping', 'monitoring', 'automation'],
  url: 'https://www.capturekit.dev',
  templates: [
    {
      icon: CaptureKitIcon,
      title: 'CaptureKit compliance archive',
      prompt:
        'Build a scheduled workflow that captures full-page PDFs of our terms of service, privacy policy and pricing pages with CaptureKit every week and stores them as time-stamped files.',
      modules: ['scheduled', 'files', 'workflows'],
      category: 'operations',
      tags: ['compliance', 'automation'],
    },
    {
      icon: CaptureKitIcon,
      title: 'CaptureKit competitor page tracker',
      prompt:
        "Create a scheduled workflow that screenshots competitors' landing and pricing pages with CaptureKit, extracts their content, and has an agent post what changed to Slack.",
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['monitoring', 'research'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CaptureKitIcon,
      title: 'CaptureKit lead website analyzer',
      prompt:
        "Build a workflow that analyzes each new lead's website with CaptureKit and writes its business type, value proposition, audience and contact emails to the CRM record.",
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['enrichment', 'automation'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: CaptureKitIcon,
      title: 'CaptureKit page to knowledge base',
      prompt:
        'Create a workflow that extracts the Markdown of a list of documentation pages with CaptureKit and loads them into a knowledge base for an agent to answer questions from.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'automation'],
    },
    {
      icon: CaptureKitIcon,
      title: 'CaptureKit mobile render check',
      prompt:
        'Build a workflow that screenshots a landing page on iPhone, Pixel and iPad with CaptureKit after each deployment and has an agent flag layouts that look broken.',
      modules: ['agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['testing', 'automation'],
    },
    {
      icon: CaptureKitIcon,
      title: 'CaptureKit social thumbnail maker',
      prompt:
        'Create a workflow that captures a 1200x630 viewport screenshot of each new blog post with CaptureKit and attaches it to the post as its social preview image.',
      modules: ['files', 'workflows'],
      category: 'marketing',
      tags: ['content', 'automation'],
    },
    {
      icon: CaptureKitIcon,
      title: 'CaptureKit link auditor',
      prompt:
        'Build a workflow that extracts the internal and external links of a list of pages with CaptureKit, writes them to a table, and has an agent flag pages with no internal links.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['seo', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'archive-web-page',
      description:
        'Capture a full-page PDF or image of a web page with CaptureKit as a dated record.',
      content:
        '# Archive Web Page\n\nKeep a time-stamped copy of a page, such as terms of service or a pricing page.\n\n## Steps\n1. Run the take screenshot operation on the page URL with format pdf (or png) and full page on.\n2. Turn on cookie banner and ad removal so the capture shows the page content.\n3. Store the file with the URL and the capture date in its name.\n\n## Output\nReturn the stored file and the date it was captured.',
    },
    {
      name: 'research-company-website',
      description:
        "Summarize a company's offer, audience and contact details from its website with CaptureKit.",
      content:
        '# Research Company Website\n\nUnderstand what a company sells before a call or outreach.\n\n## Steps\n1. Run the analyze website operation on the company homepage.\n2. Read the summary, value proposition, business type, key features and target audience.\n3. Note the emails and phone numbers found on the site.\n\n## Output\nReturn a short company brief with what it sells, to whom, and how to reach it.',
    },
    {
      name: 'extract-page-for-llm',
      description:
        'Turn a web page into clean Markdown with CaptureKit so an agent can read or summarize it.',
      content:
        '# Extract Page for LLM\n\nGet a page as clean text for summarization, research or a knowledge base.\n\n## Steps\n1. Run the extract content operation on the URL with include Markdown on.\n2. Use the title and description from the metadata as the document title and summary.\n3. Pass the Markdown to the agent or knowledge base.\n\n## Output\nReturn the page title, URL and Markdown content.',
    },
    {
      name: 'monitor-competitor-page',
      description:
        "Capture and compare a competitor's page over time with CaptureKit screenshots and content.",
      content:
        '# Monitor Competitor Page\n\nSee when a competitor changes a landing or pricing page.\n\n## Steps\n1. Run the take screenshot operation with full page on, and the extract content operation with Markdown on, for the page.\n2. Compare the Markdown with the previous capture.\n3. Keep the screenshot as evidence when the content changed.\n\n## Output\nReturn whether the page changed, a summary of the change and the new screenshot.',
    },
  ],
} as const satisfies BlockMeta
