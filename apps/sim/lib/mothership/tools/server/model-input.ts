export class ServerToolModelInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerToolModelInputError'
  }
}
