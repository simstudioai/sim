import { Block } from './base'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'

export interface ApiOptions {
  url: string
  method: HttpMethod
  headers?: Record<string, string>
  body?: any
  query?: Record<string, string>
  timeout?: number
  authentication?: {
    type: 'basic' | 'bearer' | 'api_key'
    credentials?: {
      username?: string
      password?: string
      token?: string
      key?: string
      value?: string
      in?: 'header' | 'query'
    }
  }
}

/**
 * API block for making HTTP requests
 */
export class ApiBlock extends Block {
  constructor(options: ApiOptions) {
    super('api', options)
    this.metadata.id = 'api'
  }

  /**
   * Set the request URL
   */
  setUrl(url: string): this {
    this.data.url = url
    return this
  }

  /**
   * Set the HTTP method
   */
  setMethod(method: HttpMethod): this {
    this.data.method = method
    return this
  }

  /**
   * Set request headers
   */
  setHeaders(headers: Record<string, string>): this {
    this.data.headers = headers
    return this
  }

  /**
   * Add a header
   */
  addHeader(key: string, value: string): this {
    if (!this.data.headers) {
      this.data.headers = {}
    }
    this.data.headers[key] = value
    return this
  }

  /**
   * Set the request body
   */
  setBody(body: any): this {
    this.data.body = body
    return this
  }

  /**
   * Set query parameters
   */
  setQueryParams(query: Record<string, string>): this {
    this.data.query = query
    return this
  }

  /**
   * Add a query parameter
   */
  addQueryParam(key: string, value: string): this {
    if (!this.data.query) {
      this.data.query = {}
    }
    this.data.query[key] = value
    return this
  }

  /**
   * Set request timeout
   */
  setTimeout(timeout: number): this {
    this.data.timeout = timeout
    return this
  }

  /**
   * Configure basic authentication
   */
  setBasicAuth(username: string, password: string): this {
    this.data.authentication = {
      type: 'basic',
      credentials: {
        username,
        password
      }
    }
    return this
  }

  /**
   * Configure bearer token authentication
   */
  setBearerAuth(token: string): this {
    this.data.authentication = {
      type: 'bearer',
      credentials: {
        token
      }
    }
    return this
  }

  /**
   * Configure API key authentication
   */
  setApiKeyAuth(key: string, value: string, location: 'header' | 'query' = 'header'): this {
    this.data.authentication = {
      type: 'api_key',
      credentials: {
        key,
        value,
        in: location
      }
    }
    return this
  }
} 