import { mergeDefined, prepareOperation } from '@/tools/companyenrich/dispatcher'
import type { CompanyEnrichParams } from '@/tools/companyenrich/types'
import type { ToolConfig } from '@/tools/types'

function input(params: CompanyEnrichParams, operation: string) {
  const expansion = mergeDefined({}, { expand: params.expand })
  switch (operation) {
    case 'get_companies_enrich':
      return {
        operation,
        query: mergeDefined(expansion, {
          domain: params.domain,
          waitForEnrichment: params.waitForEnrichment,
        }),
      }
    case 'post_companies_search':
    case 'post_companies_search_count':
      return {
        operation,
        body: mergeDefined(params.filters, {
          query: params.query,
          semanticQuery: params.semanticQuery,
          ...(operation.endsWith('_count') ? {} : { page: params.page, pageSize: params.pageSize }),
        }),
        query: operation.endsWith('_count') ? {} : expansion,
      }
    case 'post_companies_similar':
    case 'post_companies_similar_count':
      return {
        operation,
        body: mergeDefined(params.filters, {
          domains: params.domains ?? (params.domain === undefined ? undefined : [params.domain]),
          ...(operation.endsWith('_count') ? {} : { page: params.page, pageSize: params.pageSize }),
        }),
        query: mergeDefined(operation.endsWith('_count') ? {} : expansion, {
          waitForEnrichment: params.waitForEnrichment,
        }),
      }
    case 'post_people_search':
      return {
        operation,
        body: mergeDefined(params.filters, { page: params.page, pageSize: params.pageSize }),
        query: expansion,
      }
    case 'post_people_lookup':
      return { operation, body: { email: params.email }, query: expansion }
    case 'get_companies_workforce':
      return { operation, query: mergeDefined({}, { id: params.id, domain: params.domain }) }
    case 'post_companies_enrich':
      return { operation, body: params.properties, query: expansion }
    case 'post_companies_enrich_batch':
      return { operation, body: { domains: params.domains }, query: expansion }
    case 'get_companies':
    case 'get_people':
      return { operation, query: mergeDefined(expansion, { id: params.id }) }
    default:
      return {
        operation: params.apiOperation ?? '',
        body: params.body,
        query: params.queryParameters,
        path_parameters: params.pathParameters,
        allow_beta: params.allow_beta,
      }
  }
}

export function companyenrichRequest(
  operation: string
): ToolConfig<CompanyEnrichParams>['request'] {
  const prepare = (params: CompanyEnrichParams) => prepareOperation(input(params, operation))
  return {
    url: (params) => prepare(params).url,
    method: (params) => prepare(params).method,
    body: (params) => prepare(params).body,
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    retry: { enabled: false },
    maxRedirects: 0,
  }
}

export async function responseData(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`CompanyEnrich request failed (HTTP ${response.status})`)
  try {
    return await response.json()
  } catch {
    throw new Error('CompanyEnrich returned invalid JSON')
  }
}
