export const AWS_MARKETPLACE_TEAM_NOTICE_EVENT = 'aws-marketplace.team-notice'
export const AWS_MARKETPLACE_BUYER_NOTICE_EVENT = 'aws-marketplace.buyer-notice'

export interface AwsMarketplaceNoticeTerms {
  status: 'pending' | 'active' | 'inactive'
  dimension: string | null
  quantity: number | null
  expiresAt: string | null
}

/** What the team is told; a retry renders it again from the license's current row. */
export type AwsMarketplaceTeamNotice =
  | { kind: 'new-license'; licenseId: string; source: 'registration' | 'event' }
  | { kind: 'taken'; licenseId: string; userId: string }
  | { kind: 'contact'; licenseId: string }
  | { kind: 'license-event-received'; licenseId: string }
  | {
      kind: 'terms-changed'
      licenseId: string
      before: AwsMarketplaceNoticeTerms
      after: AwsMarketplaceNoticeTerms
    }
  | { kind: 'renewed'; licenseIds: string[]; previousAgreementId: string; agreementId: string }
  | {
      kind: 'advisory'
      licenseIds: string[]
      agreementId: string
      state: 'issued' | 'resolved'
      detail: string
    }

export interface AwsMarketplaceBuyerNotice {
  licenseId: string
}
