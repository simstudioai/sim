import { ChartQueryIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

const FORMAT_OPTIONS = [
  { label: 'PNG', id: 'png' },
  { label: 'SVG', id: 'svg' },
]

/** Reads an optional numeric field that may arrive as a string from a short input. */
function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

export const ChartQueryBlock: BlockConfig = {
  type: 'chartquery',
  name: 'ChartQuery',
  description: 'Render charts, QR codes and barcodes as shareable images',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Turn data into images with ChartQuery: render any Chart.js v4 chart from its config, describe a chart in plain language and let ChartQuery build it from your data, or generate QR codes and barcodes. Every operation stores the image and returns public links you can put in a message, an email or a document.',
  docsLink: 'https://docs.sim.ai/integrations/chartquery',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#FFFFFF',
  icon: ChartQueryIcon,
  canvasPresentation: {
    defaultTitle: 'ChartQuery',
    sentences: {
      byOperation: {
        create_chart: [{ text: 'Render', field: 'config', core: true }],
        create_chart_from_prompt: [{ text: 'Chart', field: 'prompt', core: true }],
        create_qr_code: [{ text: 'Make a QR code for', field: 'data', core: true }],
        create_barcode: [
          { text: 'Make a barcode for', field: 'data', core: true },
          { text: 'as', field: 'barcodeType' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Chart', id: 'create_chart' },
        { label: 'Create Chart From Prompt', id: 'create_chart_from_prompt' },
        { label: 'Create QR Code', id: 'create_qr_code' },
        { label: 'Create Barcode', id: 'create_barcode' },
      ],
      value: () => 'create_chart',
    },
    {
      id: 'config',
      title: 'Chart Config',
      type: 'code',
      language: 'json',
      placeholder:
        '{"type":"bar","data":{"labels":["Jan","Feb","Mar"],"datasets":[{"label":"Sales","data":[12,19,9]}]}}',
      condition: { field: 'operation', value: 'create_chart' },
      required: { field: 'operation', value: 'create_chart' },
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Write a Chart.js v4 configuration object (type, data and optional options) for the chart the user describes. Return only the JSON object.',
      },
    },
    {
      id: 'prompt',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Bar chart of Q1 revenue: Jan 12, Feb 15, Mar 9',
      condition: { field: 'operation', value: 'create_chart_from_prompt' },
      required: { field: 'operation', value: 'create_chart_from_prompt' },
    },
    {
      id: 'rawData',
      title: 'Data',
      type: 'long-input',
      placeholder: 'CSV or JSON data to chart',
      condition: { field: 'operation', value: 'create_chart_from_prompt' },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Chart title',
      condition: { field: 'operation', value: 'create_chart_from_prompt' },
      mode: 'advanced',
    },
    {
      id: 'data',
      title: 'Value',
      type: 'short-input',
      placeholder: 'Text, URL or code to encode',
      condition: { field: 'operation', value: ['create_qr_code', 'create_barcode'] },
      required: { field: 'operation', value: ['create_qr_code', 'create_barcode'] },
    },
    {
      id: 'barcodeType',
      title: 'Barcode Type',
      type: 'dropdown',
      options: [
        { label: 'Code 128', id: 'code128' },
        { label: 'EAN-13', id: 'ean13' },
        { label: 'EAN-8', id: 'ean8' },
        { label: 'UPC-A', id: 'upca' },
        { label: 'UPC-E', id: 'upce' },
        { label: 'ITF-14', id: 'itf14' },
        { label: 'ITF', id: 'itf' },
        { label: 'Code 39', id: 'code39' },
        { label: 'Code 93', id: 'code93' },
      ],
      value: () => 'code128',
      condition: { field: 'operation', value: 'create_barcode' },
    },
    {
      id: 'showText',
      title: 'Show Value Under Bars',
      type: 'switch',
      condition: { field: 'operation', value: 'create_barcode' },
      mode: 'advanced',
    },
    {
      id: 'chartFormat',
      title: 'Image Format',
      type: 'dropdown',
      options: FORMAT_OPTIONS,
      value: () => 'png',
      condition: { field: 'operation', value: ['create_chart', 'create_chart_from_prompt'] },
      mode: 'advanced',
    },
    {
      id: 'codeFormat',
      title: 'Image Format',
      type: 'dropdown',
      options: [
        { label: 'SVG', id: 'svg' },
        { label: 'PNG', id: 'png' },
      ],
      value: () => 'svg',
      condition: { field: 'operation', value: ['create_qr_code', 'create_barcode'] },
      mode: 'advanced',
    },
    {
      id: 'width',
      title: 'Width (px)',
      type: 'short-input',
      placeholder: '800',
      condition: { field: 'operation', value: ['create_chart', 'create_chart_from_prompt'] },
      mode: 'advanced',
    },
    {
      id: 'height',
      title: 'Height (px)',
      type: 'short-input',
      placeholder: '400',
      condition: { field: 'operation', value: ['create_chart', 'create_chart_from_prompt'] },
      mode: 'advanced',
    },
    {
      id: 'size',
      title: 'Size (px)',
      type: 'short-input',
      placeholder: '200',
      condition: { field: 'operation', value: 'create_qr_code' },
      mode: 'advanced',
    },
    {
      id: 'color',
      title: 'Color',
      type: 'short-input',
      placeholder: '#000000',
      condition: { field: 'operation', value: 'create_qr_code' },
      mode: 'advanced',
    },
    {
      id: 'background',
      title: 'Background',
      type: 'short-input',
      placeholder: '#ffffff or transparent',
      condition: { field: 'operation', value: ['create_chart', 'create_qr_code'] },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your ChartQuery API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'chartquery_create_chart',
      'chartquery_create_chart_from_prompt',
      'chartquery_create_qr_code',
      'chartquery_create_barcode',
    ],
    config: {
      tool: (params) => `chartquery_${params.operation}`,
      params: (params) => {
        const isChart =
          params.operation === 'create_chart' || params.operation === 'create_chart_from_prompt'
        return {
          ...params,
          format: isChart ? params.chartFormat : params.codeFormat,
          width: optionalNumber(params.width),
          height: optionalNumber(params.height),
          size: optionalNumber(params.size),
          showText:
            params.showText === undefined || params.showText === ''
              ? undefined
              : params.showText === true || params.showText === 'true',
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    config: {
      type: 'json',
      description:
        'Chart.js v4 config with type, data and optional options (e.g., {"type":"bar","data":{...}})',
    },
    prompt: {
      type: 'string',
      description: 'What to chart in plain language (e.g., "Bar chart of Q1 revenue")',
    },
    rawData: { type: 'string', description: 'Data to chart as CSV or JSON text' },
    title: { type: 'string', description: 'Chart title, replacing the generated one' },
    data: {
      type: 'string',
      description: 'Text, URL or code to encode (e.g., "https://www.chartquery.com")',
    },
    barcodeType: {
      type: 'string',
      description: 'Barcode type: code128, ean13, ean8, upca, upce, itf14, itf, code39 or code93',
    },
    showText: { type: 'boolean', description: 'Whether to print the value under the bars' },
    chartFormat: { type: 'string', description: 'Chart image format: png or svg' },
    codeFormat: { type: 'string', description: 'QR code or barcode image format: svg or png' },
    width: { type: 'number', description: 'Chart width in pixels, 50 to 4000' },
    height: { type: 'number', description: 'Chart height in pixels, 50 to 4000' },
    size: { type: 'number', description: 'QR code width and height in pixels' },
    color: { type: 'string', description: 'QR code module color as a hex value' },
    background: { type: 'string', description: 'Background color, or "transparent"' },
    apiKey: { type: 'string', description: 'ChartQuery API key' },
  },
  outputs: {
    id: { type: 'string', description: 'ID of the stored image' },
    renderUrl: {
      type: 'string',
      description: 'Public URL of the image itself, for an img tag, a message or a document',
    },
    viewUrl: { type: 'string', description: 'Public URL of a page that shows the image' },
    embedHtml: { type: 'string', description: 'HTML iframe snippet that embeds the image page' },
    expiresIn: {
      type: 'string',
      description: 'How long the links stay valid, which depends on the ChartQuery plan',
    },
  },
}

export const ChartQueryBlockMeta = {
  tags: ['data-analytics', 'image-generation', 'automation'],
  url: 'https://www.chartquery.com',
  templates: [
    {
      icon: ChartQueryIcon,
      title: 'ChartQuery weekly metrics chart',
      prompt:
        'Build a scheduled workflow that reads last week’s signups and revenue from a table every Monday, renders a bar chart with ChartQuery, and posts the chart link with a short summary to Slack.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ChartQueryIcon,
      title: 'ChartQuery chart from a question',
      prompt:
        'Create a workflow where an agent answers a data question from a table, then asks ChartQuery to chart the result from a plain-language description and returns the image link with the answer.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'productivity',
      tags: ['analysis', 'reporting'],
    },
    {
      icon: ChartQueryIcon,
      title: 'ChartQuery event QR codes',
      prompt:
        'Build a workflow that creates a QR code with ChartQuery for each new event registration link, stores the image link in a table, and emails it to the attendee.',
      modules: ['tables', 'workflows'],
      category: 'marketing',
      tags: ['automation', 'events'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ChartQueryIcon,
      title: 'ChartQuery product barcodes',
      prompt:
        'Create a workflow that generates an EAN-13 barcode with ChartQuery for each new product in a table and writes the barcode image link back to the row for label printing.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'commerce'],
    },
  ],
  skills: [
    {
      name: 'chart-table-data',
      description: 'Render a chart from table rows with ChartQuery and share the image link.',
      content:
        '# Chart Table Data\n\nTurn rows of numbers into a chart people can open from a link.\n\n## Steps\n1. Pick the label column and one or more value columns.\n2. Build a Chart.js config with the labels and one dataset per value column, choosing bar for categories and line for dates.\n3. Run the create chart operation with that config.\n\n## Output\nReturn the render URL of the chart and one sentence on what it shows.',
    },
    {
      name: 'chart-from-description',
      description:
        'Describe a chart in plain language and let ChartQuery build it from the supplied data.',
      content:
        '# Chart From Description\n\nGet a chart without writing a Chart.js config.\n\n## Steps\n1. Write a short description naming the chart type, what each axis shows and the period.\n2. Pass the data as CSV or JSON in the data field.\n3. Run the create chart from prompt operation.\n\n## Output\nReturn the render URL of the chart.',
    },
    {
      name: 'qr-code-for-link',
      description: 'Generate a QR code image for a URL with ChartQuery.',
      content:
        '# QR Code For Link\n\nGive people a scannable code for a page, a form or a Wi-Fi network.\n\n## Steps\n1. Run the create QR code operation with the URL or text as the value.\n2. Choose PNG when the image goes into an email or a chat message.\n\n## Output\nReturn the render URL of the QR code.',
    },
  ],
} as const satisfies BlockMeta
