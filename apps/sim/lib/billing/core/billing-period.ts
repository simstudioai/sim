const OPEN_BILLING_PERIOD_START = new Date(0)
const OPEN_BILLING_PERIOD_END = new Date(Date.UTC(9999, 11, 31))

export function defaultBillingPeriod(): { start: Date; end: Date } {
  return {
    start: OPEN_BILLING_PERIOD_START,
    end: OPEN_BILLING_PERIOD_END,
  }
}
