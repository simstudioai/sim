export interface ApiClientErrorOptions {
  status: number
  message: string
  body: unknown
  rawBody?: string
  code?: string
}

export class ApiClientError extends Error {
  readonly status: number
  readonly body: unknown
  readonly rawBody?: string
  readonly code?: string

  constructor(options: ApiClientErrorOptions) {
    super(options.message)
    this.name = 'ApiClientError'
    this.status = options.status
    this.body = options.body
    this.rawBody = options.rawBody
    this.code = options.code
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError
}
