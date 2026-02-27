import { ShortIoIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export const ShortIoBlock: BlockConfig<ToolResponse> = {
    type: 'short_io',
    name: 'Short.io',
    description: 'Create and manage short links, domains, and analytics.',
    authMode: AuthMode.ApiKey,
    longDescription:
        'Integrate Short.io to generate branded short links, list domains and links, delete links, generate QR codes, and view link statistics. Requires your Short.io Secret API Key.',
    docsLink: 'https://docs.sim.ai/tools/short_io',
    category: 'tools',
    bgColor: '#FFFFFF',
    icon: ShortIoIcon,
    subBlocks: [
        {
            id: 'operation',
            title: 'Operation',
            type: 'dropdown',
            options: [
                { label: 'Create Link', id: 'create_link' },
                { label: 'List Domains', id: 'list_domains' },
                { label: 'List Links', id: 'list_links' },
                { label: 'Delete Link', id: 'delete_link' },
                { label: 'Get QR Code', id: 'get_qr_code' },
                { label: 'Get Link Statistics', id: 'get_analytics' },
            ],
            value: () => 'create_link',
        },
        {
            id: 'apiKey',
            title: 'Secret API Key',
            type: 'short-input',
            mode: 'basic',
            required: true,
            password: true,
            placeholder: 'sk_...',
        },
        {
            id: 'domain',
            title: 'Custom Domain',
            type: 'short-input',
            placeholder: 'link.yourbrand.com',
            condition: { field: 'operation', value: 'create_link' },
            required: true,
        },
        {
            id: 'originalURL',
            title: 'Original URL',
            type: 'long-input',
            placeholder: 'https://www.example.com/very/long/path/to/page',
            condition: { field: 'operation', value: 'create_link' },
            required: true,
        },
        {
            id: 'path',
            title: 'Custom Path (Optional)',
            type: 'short-input',
            placeholder: 'my-custom-path',
            condition: { field: 'operation', value: 'create_link' },
            required: false,
        },
        {
            id: 'domainId',
            title: 'Domain ID',
            type: 'short-input',
            placeholder: '12345',
            condition: { field: 'operation', value: 'list_links' },
            required: true,
        },
        {
            id: 'limit',
            title: 'Limit (1–150)',
            type: 'short-input',
            placeholder: '50',
            condition: { field: 'operation', value: 'list_links' },
            required: false,
        },
        {
            id: 'pageToken',
            title: 'Page Token',
            type: 'short-input',
            placeholder: 'Next page token',
            condition: { field: 'operation', value: 'list_links' },
            required: false,
        },
        {
            id: 'linkId',
            title: 'Short.io Link ID',
            type: 'short-input',
            placeholder: 'lnk_abc123_abcdef',
            condition: {
                field: 'operation',
                value: ['get_qr_code', 'get_analytics', 'delete_link'],
            },
            required: true,
        },
        {
            id: 'type',
            title: 'QR Format',
            type: 'dropdown',
            options: [
                { label: 'PNG', id: 'png' },
                { label: 'SVG', id: 'svg' },
            ],
            condition: { field: 'operation', value: 'get_qr_code' },
            required: false,
            value: () => 'png',
        },
        {
            id: 'size',
            title: 'QR Size (1–99)',
            type: 'short-input',
            placeholder: '10',
            condition: { field: 'operation', value: 'get_qr_code' },
            required: false,
        },
        {
            id: 'color',
            title: 'QR Color (hex)',
            type: 'short-input',
            placeholder: '000000',
            condition: { field: 'operation', value: 'get_qr_code' },
            required: false,
        },
        {
            id: 'backgroundColor',
            title: 'Background Color (hex)',
            type: 'short-input',
            placeholder: 'FFFFFF',
            condition: { field: 'operation', value: 'get_qr_code' },
            required: false,
        },
        {
            id: 'period',
            title: 'Statistics Period',
            type: 'dropdown',
            options: [
                { label: 'Today', id: 'today' },
                { label: 'Yesterday', id: 'yesterday' },
                { label: 'Last 7 Days', id: 'last_7_days' },
                { label: 'Last 30 Days', id: 'last_30_days' },
                { label: 'All Time', id: 'all_time' },
            ],
            condition: { field: 'operation', value: 'get_analytics' },
            required: true,
            value: () => 'last_30_days',
        },
    ],
    tools: {
        access: [
            'short_io_create_link',
            'short_io_list_domains',
            'short_io_list_links',
            'short_io_delete_link',
            'short_io_get_qr_code',
            'short_io_get_analytics',
        ],
        config: {
            tool: (params) => `short_io_${params.operation}`,
            params: (params) => {
                const { apiKey, operation, size, domainId, limit, ...rest } = params
                const out: Record<string, unknown> = { ...rest, apiKey }
                if (size !== undefined && size !== '') {
                    const n = Number(size)
                    if (typeof n === 'number' && !isNaN(n) && n >= 1 && n <= 99) out.size = n
                }
                if (operation === 'list_links' && domainId !== undefined && domainId !== '') {
                    const d = Number(domainId)
                    if (typeof d === 'number' && !isNaN(d)) out.domainId = d
                }
                if (operation === 'list_links' && limit !== undefined && limit !== '') {
                    const l = Number(limit)
                    if (typeof l === 'number' && !isNaN(l) && l >= 1 && l <= 150) out.limit = l
                }
                return out
            },
        },
    },
    inputs: {
        apiKey: { type: 'string', description: 'Secret API Key' },
        operation: { type: 'string', description: 'Short.io operation to perform' },
        domain: { type: 'string', description: 'Your registered Short.io custom domain' },
        originalURL: { type: 'string', description: 'The original long URL to shorten' },
        path: { type: 'string', description: 'Optional custom path for the short link' },
        domainId: { type: 'number', description: 'Domain ID (from List Domains)' },
        limit: { type: 'number', description: 'Max links to return (1–150)' },
        pageToken: { type: 'string', description: 'Pagination token for List Links' },
        linkId: { type: 'string', description: 'The Short.io internal link ID string' },
        type: { type: 'string', description: 'QR output format: png or svg' },
        size: { type: 'number', description: 'QR size 1–99' },
        color: { type: 'string', description: 'QR color hex' },
        backgroundColor: { type: 'string', description: 'QR background color hex' },
        period: { type: 'string', description: 'Statistics period (e.g. today, last_30_days, all_time)' },
        tz: { type: 'string', description: 'Timezone for statistics (e.g. UTC)' },
    },
    outputs: {
        success: { type: 'boolean', description: 'Operation success status' },
        shortURL: { type: 'string', description: 'The generated short link' },
        idString: { type: 'string', description: 'The Short.io link ID' },
        domains: { type: 'array', description: 'List of domains (from List Domains)' },
        count: { type: 'number', description: 'Number of domains or links returned' },
        links: { type: 'array', description: 'List of links (from List Links)' },
        nextPageToken: { type: 'string', description: 'Pagination token for next page' },
        deleted: { type: 'boolean', description: 'Whether the link was deleted' },
        file: { type: 'file', description: 'Generated QR code image file' },
        clicks: { type: 'number', description: 'Total clicks in period' },
        totalClicks: { type: 'number', description: 'Total clicks' },
        humanClicks: { type: 'number', description: 'Human clicks' },
        totalClicksChange: { type: 'string', description: 'Change in total clicks vs previous period' },
        humanClicksChange: { type: 'string', description: 'Change in human clicks vs previous period' },
        referer: { type: 'array', description: 'Referrer breakdown (referer, score)' },
        country: { type: 'array', description: 'Country breakdown (countryName, country, score)' },
        browser: { type: 'array', description: 'Browser breakdown (browser, score)' },
        os: { type: 'array', description: 'OS breakdown (os, score)' },
        city: { type: 'array', description: 'City breakdown (city, name, countryCode, score)' },
        device: { type: 'array', description: 'Device breakdown' },
        social: { type: 'array', description: 'Social source breakdown (social, score)' },
        utmMedium: { type: 'array', description: 'UTM medium breakdown' },
        utmSource: { type: 'array', description: 'UTM source breakdown' },
        utmCampaign: { type: 'array', description: 'UTM campaign breakdown' },
        clickStatistics: { type: 'object', description: 'Time-series click data (datasets with x/y per interval)' },
        interval: { type: 'object', description: 'Date range (startDate, endDate, prevStartDate, prevEndDate, tz)' },
        error: { type: 'string', description: 'Error message if operation failed' },
    },
}
