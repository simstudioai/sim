import { SemrushIcon } from '@/components/icons'
import {
  SemrushDomainOverviewResponse,
  SemrushDomainKeywordsResponse,
  SemrushKeywordOverviewResponse,
  SemrushUrlKeywordsResponse
} from '@/tools/semrush/types'
import { BlockConfig } from '../types';

type SemrushBlockResponse =
  SemrushDomainOverviewResponse |
  SemrushDomainKeywordsResponse |
  SemrushKeywordOverviewResponse |
  SemrushUrlKeywordsResponse

export const SemrushBlock: BlockConfig<SemrushBlockResponse> = {
  type: 'semrush',
  name: 'Semrush',
  description: 'Semrush SEO and keyword data',
  longDescription: 'This block integrates Semrush data by offering tools to retrieve domain SEO metrics, domain keyword data, keyword SEO metrics, and URL keyword data. Users can select the desired operation, enter domains or keywords, and authenticate using their Semrush API key.',
  category: 'tools',
  bgColor: '#F5F5F5',
  icon: SemrushIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Domain Overview', id: 'domain_overview' },
        { label: 'Domain Keywords', id: 'domain_keywords' },
        { label: 'Keyword Overview', id: 'keyword_overview' },
        { label: 'URL Keywords', id: 'url_keywords' },
      ]
    },
    {
      id: 'apiKey',
      title: 'Semrush API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Semrush API key'
    },
    // Common input for domain-based operations.
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g., example.com',
      condition: { field: 'operation', value: ['domain_overview', 'domain_keywords'] }
    },
    // Input for keyword overview.
    {
      id: 'keyword',
      title: 'Keyword',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g., SEO tools',
      condition: { field: 'operation', value: 'keyword_overview' }
    },
    // Input for URL keywords.
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g., https://example.com/page',
      condition: { field: 'operation', value: 'url_keywords' }
    },
  ],

  tools: {
    access: [
      'semrush_domain_overview',
      'semrush_domain_keywords',
      'semrush_keyword_overview',
      'semrush_url_keywords'
    ],
    config: {
      tool: (params: Record<string, any>) => {
        switch (params.operation) {
          case 'domain_overview': return 'semrush_domain_overview';
          case 'domain_keywords': return 'semrush_domain_keywords';
          case 'keyword_overview': return 'semrush_keyword_overview';
          case 'url_keywords': return 'semrush_url_keywords';
          default:
            throw new Error("Invalid operation selected");
        }
      }
    }
  },

  inputs: {
    apiKey: { type: 'string', required: true },
    // When a domain is needed.
    domain: { type: 'string', required: true },
    // When a keyword is needed.
    keyword: { type: 'string', required: true },
    // When a URL is needed.
    url: { type: 'string', required: true },
    operation: { type: 'string', required: true }
  },

  outputs: {
    response: {
      type: 'json',
    }
  }
}