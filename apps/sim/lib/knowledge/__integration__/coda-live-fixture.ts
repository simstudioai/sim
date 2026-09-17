import { normalizeEmail } from '@sim/utils/string'

/** Checks the disposable document and distinct identities before live sharing mutations. */
export function assertCodaLiveFixture(
  source: { name: string; owner: string },
  marker: string,
  secondEmail: string
): void {
  if (
    source.name !== `Sim Coda connector verification ${marker}` ||
    normalizeEmail(source.owner) === normalizeEmail(secondEmail)
  ) {
    throw new Error('Refusing to change sharing on a non-fixture document')
  }
}
