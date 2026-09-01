export class SelectorContextUnavailableError extends Error {
  constructor() {
    super('Context unavailable')
    this.name = 'SelectorContextUnavailableError'
  }
}

export class SelectorConnectionUnavailableError extends Error {
  readonly status: 401 | 403

  constructor(status: 401 | 403 = 403) {
    super('Connection unavailable')
    this.name = 'SelectorConnectionUnavailableError'
    this.status = status
  }
}

export class SelectorOptionsUnavailableError extends Error {
  readonly status: 429 | 502

  constructor(status: 429 | 502 = 502) {
    super('Options unavailable')
    this.name = 'SelectorOptionsUnavailableError'
    this.status = status
  }
}
