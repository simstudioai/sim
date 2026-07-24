export class PiStreamingRedactor {
  private readonly representations: string[]
  private pending = ''

  constructor(secrets: readonly string[]) {
    this.representations = [
      ...new Set(
        secrets
          .flatMap((secret) => (secret ? [secret, encodeURIComponent(secret)] : []))
          .filter(Boolean)
      ),
    ].sort((left, right) => right.length - left.length)
  }

  push(chunk: string): string {
    let output = ''
    for (const character of chunk) {
      this.pending += character
      let progressing = true
      while (this.pending && progressing) {
        progressing = false
        const complete = this.representations.find((secret) => this.pending.startsWith(secret))
        if (complete && this.pending.length >= complete.length) {
          output += '***'
          this.pending = this.pending.slice(complete.length)
          progressing = true
          continue
        }
        if (this.representations.some((secret) => secret.startsWith(this.pending))) break
        output += this.pending[0]
        this.pending = this.pending.slice(1)
        progressing = true
      }
    }
    return output
  }

  flush(): string {
    const remaining = this.pending
    this.pending = ''
    return remaining && this.representations.some((secret) => secret.startsWith(remaining))
      ? '***'
      : remaining
  }
}
