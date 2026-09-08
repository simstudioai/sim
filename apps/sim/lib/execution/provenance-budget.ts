import {
  PROVENANCE_MAX_ENTRIES,
  PROVENANCE_MAX_SERIALIZED_BYTES,
} from '@/lib/execution/provenance-limits'

/** Tracks distinct secrets and serialized bytes while callers fold durable bindings incrementally. */
export class SecretProvenanceBudget {
  private readonly encryptedValues = new Set<string>()
  private serializedBytes = 2
  private bindingCount = 0

  /** Admits one deduplicated binding, including its JSON array separator in the byte budget. */
  add(encryptedValue: string, serializedEntryBytes: number): boolean {
    const nextBytes = this.serializedBytes + serializedEntryBytes + (this.bindingCount > 0 ? 1 : 0)
    if (
      nextBytes > PROVENANCE_MAX_SERIALIZED_BYTES ||
      (!this.encryptedValues.has(encryptedValue) &&
        this.encryptedValues.size >= PROVENANCE_MAX_ENTRIES)
    ) {
      return false
    }
    this.encryptedValues.add(encryptedValue)
    this.serializedBytes = nextBytes
    this.bindingCount++
    return true
  }
}
