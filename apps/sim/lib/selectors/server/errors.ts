export class SelectorContextUnavailableError extends Error {
  constructor() {
    super('Context unavailable')
    this.name = 'SelectorContextUnavailableError'
  }
}

export class SelectorConnectionUnavailableError extends Error {
  constructor() {
    super('Connection unavailable')
    this.name = 'SelectorConnectionUnavailableError'
  }
}

export class SelectorOptionsUnavailableError extends Error {
  constructor() {
    super('Options unavailable')
    this.name = 'SelectorOptionsUnavailableError'
  }
}
