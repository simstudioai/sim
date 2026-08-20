import { Building } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { PitchBookIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { PitchbookResponse } from '@/tools/pitchbook/types'

/**
 * Search subblock ids are prefixed per entity family because subblock ids must
 * be unique block-wide, while the PitchBook filters they map onto repeat across
 * search endpoints (`country`, `dealType`, `dealDate`, ...). Each entry records
 * both the query parameter the tool expects and the operation that owns it.
 *
 * The owning operation is load-bearing, not documentation. The serializer emits
 * an advanced subBlock whenever it holds a non-empty value, without evaluating
 * its `condition`, so a country typed on Search Companies is still serialized
 * while Search Deals is selected. Because the prefixed ids collapse onto shared
 * PitchBook filter names, renaming unconditionally would let that stale value
 * overwrite the live one — silently returning results for filters the UI is not
 * showing. Every mapped key is therefore cleared to `undefined` unless the
 * current operation owns it.
 */
const SEARCH_FIELD_TO_PARAM: Record<string, { param: string; operation: string }> = {
  coNames: { param: 'companyNames', operation: 'company_search' },
  coKeywords: { param: 'keywords', operation: 'company_search' },
  coCountry: { param: 'country', operation: 'company_search' },
  coIndustry: { param: 'industry', operation: 'company_search' },
  coVerticals: { param: 'verticals', operation: 'company_search' },
  coDealType: { param: 'dealType', operation: 'company_search' },
  coDealDate: { param: 'dealDate', operation: 'company_search' },
  coDealSize: { param: 'dealSize', operation: 'company_search' },
  coTotalRaised: { param: 'totalRaised', operation: 'company_search' },
  coEmployeeCount: { param: 'employeeCount', operation: 'company_search' },
  coInvestorNames: { param: 'investorNames', operation: 'company_search' },
  dealCompanyNames: { param: 'companyNames', operation: 'deal_search' },
  dealInvestorNames: { param: 'investorNames', operation: 'deal_search' },
  dealTypeFilter: { param: 'dealType', operation: 'deal_search' },
  dealStatusFilter: { param: 'dealStatus', operation: 'deal_search' },
  dealSizeFilter: { param: 'dealSize', operation: 'deal_search' },
  dealDateFilter: { param: 'dealDate', operation: 'deal_search' },
  dealCountry: { param: 'country', operation: 'deal_search' },
  dealIndustry: { param: 'industry', operation: 'deal_search' },
  invNames: { param: 'investorNames', operation: 'investor_search' },
  invType: { param: 'investorType', operation: 'investor_search' },
  invCountry: { param: 'country', operation: 'investor_search' },
  invAum: { param: 'aum', operation: 'investor_search' },
  invDryPowder: { param: 'dryPowder', operation: 'investor_search' },
  invDealType: { param: 'dealType', operation: 'investor_search' },
  invDealDate: { param: 'dealDate', operation: 'investor_search' },
  pplNames: { param: 'personNames', operation: 'people_search' },
  pplFirstName: { param: 'firstName', operation: 'people_search' },
  pplLastName: { param: 'lastName', operation: 'people_search' },
  pplFirmNames: { param: 'firmNames', operation: 'people_search' },
  pplPositionLevel: { param: 'positionLevel', operation: 'people_search' },
  pplPositionTitle: { param: 'positionTitle', operation: 'people_search' },
  pplCountry: { param: 'country', operation: 'people_search' },
  fundNames: { param: 'fundNames', operation: 'fund_search' },
  fundInvestorNames: { param: 'investorNames', operation: 'fund_search' },
  fundTypeFilter: { param: 'fundType', operation: 'fund_search' },
  fundSizeFilter: { param: 'fundSize', operation: 'fund_search' },
  fundVintage: { param: 'vintage', operation: 'fund_search' },
  fundCountry: { param: 'country', operation: 'fund_search' },
  fundIrr: { param: 'irr', operation: 'fund_search' },
  lpNames: { param: 'limitedPartnerNames', operation: 'limited_partner_search' },
  lpType: { param: 'limitedPartnerType', operation: 'limited_partner_search' },
  lpCountry: { param: 'country', operation: 'limited_partner_search' },
  lpAum: { param: 'aum', operation: 'limited_partner_search' },
  lpNumCommitments: { param: 'numberOfCommitments', operation: 'limited_partner_search' },
  spNames: { param: 'serviceProviderNames', operation: 'service_provider_search' },
  spType: { param: 'serviceProviderType', operation: 'service_provider_search' },
  spCountry: { param: 'country', operation: 'service_provider_search' },
  spDealType: { param: 'dealType', operation: 'service_provider_search' },
  spDealDate: { param: 'dealDate', operation: 'service_provider_search' },
  patentStatus: { param: 'status', operation: 'patent_search' },
  patentPublicationDate: { param: 'publicationDate', operation: 'patent_search' },
  patentFirstFilingDate: { param: 'firstFilingDate', operation: 'patent_search' },
  patentFilingAuthority: { param: 'filingAuthorityLocation', operation: 'patent_search' },
  patentCpcSectionCode: { param: 'cpcSectionCode', operation: 'patent_search' },
  patentCpcClassCode: { param: 'cpcClassCode', operation: 'patent_search' },
  newsAuthors: { param: 'authors', operation: 'credit_news_search' },
  newsRegions: { param: 'regions', operation: 'credit_news_search' },
  newsAssetClasses: { param: 'assetClasses', operation: 'credit_news_search' },
  newsTopics: { param: 'topics', operation: 'credit_news_search' },
  newsIssuer: { param: 'issuer', operation: 'credit_news_search' },
  newsLender: { param: 'lender', operation: 'credit_news_search' },
  newsSponsor: { param: 'sponsor', operation: 'credit_news_search' },
  sandboxEntityType: { param: 'entityType', operation: 'sandbox_entities' },
  sharedEntityType: { param: 'entityType', operation: 'shared_search' },
}

/**
 * Which entity-ID subblock each operation reads, all of which map onto the tool
 * `pbId` param. Separate subblocks exist so every operation can carry the right
 * label, placeholder, and example ID format.
 *
 * Keyed by operation for the same reason `SEARCH_FIELD_TO_PARAM` is: the
 * executor merges raw subblock state underneath this result, so a leftover
 * `dealId` would otherwise overwrite the `companyId` the current operation is
 * actually showing — sending a profile lookup to the wrong resource and
 * spending credits on it.
 */
const ID_SUBBLOCK_FOR_OPERATION: Record<string, string> = {
  entity_people: 'entityId',
  entity_locations: 'entityId',
  entity_affiliates: 'entityId',
  entity_news: 'entityId',
  entity_updates: 'entityId',
  company_bio: 'companyId',
  company_industries: 'companyId',
  company_investors: 'companyId',
  company_active_investors: 'companyId',
  company_deals: 'companyId',
  company_most_recent_financing: 'companyId',
  company_most_recent_debt_financing: 'companyId',
  company_most_recent_financials: 'companyId',
  company_financials: 'companyId',
  company_similar_companies: 'companyId',
  company_vc_exit_predictions: 'companyId',
  company_social_analytics: 'companyId',
  company_general_service_providers: 'companyId',
  company_deal_service_providers: 'companyId',
  company_updates: 'companyId',
  patent_search: 'companyId',
  patent_detailed: 'patentId',
  deal_bio: 'dealId',
  deal_detailed: 'dealId',
  deal_valuation: 'dealId',
  deal_multiples: 'dealId',
  deal_investors: 'dealId',
  deal_stock_info: 'dealId',
  deal_cap_table_history: 'dealId',
  deal_tranche_info: 'dealId',
  deal_debt_lenders: 'dealId',
  deal_service_providers: 'dealId',
  deal_updates: 'dealId',
  investor_bio: 'investorId',
  investor_investments: 'investorId',
  investor_active_investments: 'investorId',
  investor_funds: 'investorId',
  investor_last_closed_fund: 'investorId',
  investor_preferences: 'investorId',
  investor_board_seats: 'investorId',
  investor_general_service_providers: 'investorId',
  investor_deal_service_providers: 'investorId',
  investor_updates: 'investorId',
  person_bio: 'personId',
  person_contact: 'personId',
  person_education_work: 'personId',
  fund_bio: 'fundId',
  fund_performance: 'fundId',
  fund_benchmark: 'fundId',
  fund_cash_flows: 'fundId',
  fund_investments: 'fundId',
  fund_active_investments: 'fundId',
  fund_commitments: 'fundId',
  fund_investment_preferences: 'fundId',
  fund_team: 'fundId',
  fund_updates: 'fundId',
  limited_partner_bio: 'limitedPartnerId',
  limited_partner_commitments_detailed: 'limitedPartnerId',
  limited_partner_commitment_aggregates: 'limitedPartnerId',
  limited_partner_commitment_preferences: 'limitedPartnerId',
  limited_partner_actual_allocations: 'limitedPartnerId',
  limited_partner_target_allocations: 'limitedPartnerId',
  limited_partner_service_providers: 'limitedPartnerId',
  limited_partner_updates: 'limitedPartnerId',
  service_provider_bio: 'serviceProviderId',
  serviced_companies: 'serviceProviderId',
  serviced_deals: 'serviceProviderId',
  serviced_investors: 'serviceProviderId',
  serviced_funds: 'serviceProviderId',
  serviced_limited_partners: 'serviceProviderId',
  service_provider_updates: 'serviceProviderId',
  credit_news: 'articleId',
}

/** Every entity-ID subblock, so each one can be cleared before `pbId` is set. */
const ID_SUBBLOCK_IDS = Object.values(ID_SUBBLOCK_FOR_OPERATION)

/** Coerce a subblock value to a number, dropping blanks and non-numeric input. */
function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const PitchBookBlock: BlockConfig<PitchbookResponse> = {
  type: 'pitchbook',
  name: 'PitchBook',
  description: 'Look up private market data on companies, deals, investors, funds, and people',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrates the PitchBook Public API into the workflow. Search and pull profiles across companies, deals, investors, people, funds, limited partners, and service providers, including financing history, valuations, cap tables, debt and lenders, fund performance and commitments, patents, and credit analysis news. Also reports API credit usage and the lookup-table codes the search filters expect. Every call consumes PitchBook API credits.',
  docsLink: 'https://docs.sim.ai/integrations/pitchbook',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#1D5080',
  icon: PitchBookIcon,
  canvasPresentation: {
    defaultTitle: 'PitchBook',
    sentences: {
      byOperation: {
        search: ['Search PitchBook for', { text: '', field: 'query', core: true }],
        shared_search: [
          { text: 'Extract the shared search', field: 'searchId', core: true },
          { text: ', as', field: 'sharedEntityType' },
        ],
        entity_people: [
          { text: 'List the team and board at entity', field: 'entityId', core: true },
        ],
        entity_locations: [{ text: 'List the offices of entity', field: 'entityId', core: true }],
        entity_affiliates: [
          { text: 'List the affiliates of entity', field: 'entityId', core: true },
        ],
        entity_news: [
          { text: 'Fetch recent news for entity', field: 'entityId', core: true },
          { text: ', over the last', field: 'trailingRange' },
        ],
        entity_updates: [
          { text: 'Check what changed on entity', field: 'entityId', core: true },
          { text: ', since', field: 'sinceDate' },
          { text: ', over the last', field: 'trailingRange' },
        ],
        company_search: [
          'Search companies',
          { text: ', named', field: 'coNames' },
          { text: ', matching', field: 'coKeywords' },
          { text: ', in', field: 'coCountry' },
          { text: ', backed by', field: 'coInvestorNames' },
        ],
        company_bio: [
          { text: 'Fetch the PitchBook profile for company', field: 'companyId', core: true },
        ],
        company_industries: [
          {
            text: 'Fetch the industries and verticals for company',
            field: 'companyId',
            core: true,
          },
        ],
        company_investors: [
          { text: 'List every investor in company', field: 'companyId', core: true },
        ],
        company_active_investors: [
          { text: 'List the current investors in company', field: 'companyId', core: true },
        ],
        company_deals: [{ text: 'List every deal for company', field: 'companyId', core: true }],
        company_most_recent_financing: [
          { text: 'Fetch the latest financing round for company', field: 'companyId', core: true },
        ],
        company_most_recent_debt_financing: [
          { text: 'Fetch the latest debt financing for company', field: 'companyId', core: true },
        ],
        company_most_recent_financials: [
          {
            text: 'Fetch the latest reported financials for company',
            field: 'companyId',
            core: true,
          },
        ],
        company_financials: [
          {
            text: 'Fetch every reported fiscal period for company',
            field: 'companyId',
            core: true,
          },
        ],
        company_similar_companies: [
          { text: 'Find companies similar to', field: 'companyId', core: true },
        ],
        company_vc_exit_predictions: [
          { text: 'Fetch VC exit predictions for company', field: 'companyId', core: true },
        ],
        company_social_analytics: [
          {
            text: 'Fetch web and social growth metrics for company',
            field: 'companyId',
            core: true,
          },
        ],
        company_general_service_providers: [
          { text: 'List the service providers engaged by company', field: 'companyId', core: true },
        ],
        company_deal_service_providers: [
          {
            text: 'List the service providers on the deals of company',
            field: 'companyId',
            core: true,
          },
        ],
        company_updates: [
          { text: 'Check what changed on company', field: 'companyId', core: true },
          { text: ', since', field: 'sinceDate' },
          { text: ', over the last', field: 'trailingRange' },
        ],
        patent_search: [
          { text: 'Search the patents of company', field: 'companyId', core: true },
          { text: ', with status', field: 'patentStatus' },
          { text: ', filed', field: 'patentFirstFilingDate' },
        ],
        patent_detailed: [
          { text: 'Fetch the full record for patent', field: 'patentId', core: true },
        ],
        deal_search: [
          'Search deals',
          { text: ', involving', field: 'dealCompanyNames' },
          { text: ', backed by', field: 'dealInvestorNames' },
          { text: ', of type', field: 'dealTypeFilter' },
          { text: ', closed', field: 'dealDateFilter' },
        ],
        deal_bio: [{ text: 'Fetch the summary of deal', field: 'dealId', core: true }],
        deal_detailed: [{ text: 'Fetch the full detail of deal', field: 'dealId', core: true }],
        deal_valuation: [{ text: 'Fetch the valuation for deal', field: 'dealId', core: true }],
        deal_multiples: [
          { text: 'Fetch the valuation multiples for deal', field: 'dealId', core: true },
        ],
        deal_investors: [
          { text: 'List the investors and exiters on deal', field: 'dealId', core: true },
        ],
        deal_stock_info: [{ text: 'Fetch the share terms of deal', field: 'dealId', core: true }],
        deal_cap_table_history: [
          { text: 'Fetch the cap table as of deal', field: 'dealId', core: true },
        ],
        deal_tranche_info: [
          { text: 'List the funding tranches of deal', field: 'dealId', core: true },
        ],
        deal_debt_lenders: [
          { text: 'List the debt and lenders on deal', field: 'dealId', core: true },
        ],
        deal_service_providers: [
          { text: 'List the service providers on deal', field: 'dealId', core: true },
        ],
        deal_updates: [
          { text: 'Check what changed on deal', field: 'dealId', core: true },
          { text: ', since', field: 'sinceDate' },
          { text: ', over the last', field: 'trailingRange' },
        ],
        investor_search: [
          'Search investors',
          { text: ', named', field: 'invNames' },
          { text: ', of type', field: 'invType' },
          { text: ', in', field: 'invCountry' },
          { text: ', managing', field: 'invAum' },
        ],
        investor_bio: [
          { text: 'Fetch the PitchBook profile for investor', field: 'investorId', core: true },
        ],
        investor_investments: [
          { text: 'List every investment made by investor', field: 'investorId', core: true },
        ],
        investor_active_investments: [
          { text: 'List the current positions held by investor', field: 'investorId', core: true },
        ],
        investor_funds: [
          { text: 'List the funds managed by investor', field: 'investorId', core: true },
        ],
        investor_last_closed_fund: [
          {
            text: 'Fetch the most recently closed fund of investor',
            field: 'investorId',
            core: true,
          },
        ],
        investor_preferences: [
          { text: 'Fetch the investment preferences of investor', field: 'investorId', core: true },
        ],
        investor_board_seats: [
          { text: 'List the board seats held by investor', field: 'investorId', core: true },
        ],
        investor_general_service_providers: [
          {
            text: 'List the service providers engaged by investor',
            field: 'investorId',
            core: true,
          },
        ],
        investor_deal_service_providers: [
          {
            text: 'List the service providers on the deals of investor',
            field: 'investorId',
            core: true,
          },
        ],
        investor_updates: [
          { text: 'Check what changed on investor', field: 'investorId', core: true },
          { text: ', since', field: 'sinceDate' },
          { text: ', over the last', field: 'trailingRange' },
        ],
        people_search: [
          'Search people',
          { text: ', named', field: 'pplNames' },
          { text: ', at', field: 'pplFirmNames' },
          { text: ', at level', field: 'pplPositionLevel' },
          { text: ', titled', field: 'pplPositionTitle' },
        ],
        person_bio: [
          { text: 'Fetch the PitchBook profile for person', field: 'personId', core: true },
        ],
        person_contact: [
          { text: 'Fetch contact details for person', field: 'personId', core: true },
        ],
        person_education_work: [
          { text: 'Fetch the education and work history of person', field: 'personId', core: true },
        ],
        fund_search: [
          'Search funds',
          { text: ', named', field: 'fundNames' },
          { text: ', managed by', field: 'fundInvestorNames' },
          { text: ', of type', field: 'fundTypeFilter' },
          { text: ', sized', field: 'fundSizeFilter' },
        ],
        fund_bio: [{ text: 'Fetch the PitchBook profile for fund', field: 'fundId', core: true }],
        fund_performance: [
          { text: 'Fetch the latest returns for fund', field: 'fundId', core: true },
        ],
        fund_benchmark: [
          { text: 'Fetch the peer benchmark for fund', field: 'fundId', core: true },
        ],
        fund_cash_flows: [
          { text: 'Fetch cash flows for fund', field: 'fundId', core: true },
          { text: 'as of', field: 'period', core: true },
        ],
        fund_investments: [
          { text: 'List every investment made by fund', field: 'fundId', core: true },
        ],
        fund_active_investments: [
          { text: 'List the current positions held by fund', field: 'fundId', core: true },
        ],
        fund_commitments: [
          { text: 'List the limited partners committed to fund', field: 'fundId', core: true },
        ],
        fund_investment_preferences: [
          { text: 'Fetch the investment preferences of fund', field: 'fundId', core: true },
        ],
        fund_team: [{ text: 'List the team on fund', field: 'fundId', core: true }],
        fund_updates: [
          { text: 'Check what changed on fund', field: 'fundId', core: true },
          { text: ', since', field: 'sinceDate' },
          { text: ', over the last', field: 'trailingRange' },
        ],
        limited_partner_search: [
          'Search limited partners',
          { text: ', named', field: 'lpNames' },
          { text: ', of type', field: 'lpType' },
          { text: ', in', field: 'lpCountry' },
          { text: ', managing', field: 'lpAum' },
        ],
        limited_partner_bio: [
          {
            text: 'Fetch the PitchBook profile for limited partner',
            field: 'limitedPartnerId',
            core: true,
          },
        ],
        limited_partner_commitments_detailed: [
          {
            text: 'List the fund commitments of limited partner',
            field: 'limitedPartnerId',
            core: true,
          },
        ],
        limited_partner_commitment_aggregates: [
          {
            text: 'Fetch commitment totals by fund type for limited partner',
            field: 'limitedPartnerId',
            core: true,
          },
        ],
        limited_partner_commitment_preferences: [
          {
            text: 'Fetch the commitment preferences of limited partner',
            field: 'limitedPartnerId',
            core: true,
          },
        ],
        limited_partner_actual_allocations: [
          {
            text: 'Fetch the reported asset allocation of limited partner',
            field: 'limitedPartnerId',
            core: true,
          },
        ],
        limited_partner_target_allocations: [
          {
            text: 'Fetch the target asset allocation of limited partner',
            field: 'limitedPartnerId',
            core: true,
          },
        ],
        limited_partner_service_providers: [
          {
            text: 'List the service providers engaged by limited partner',
            field: 'limitedPartnerId',
            core: true,
          },
        ],
        limited_partner_updates: [
          { text: 'Check what changed on limited partner', field: 'limitedPartnerId', core: true },
          { text: ', since', field: 'sinceDate' },
          { text: ', over the last', field: 'trailingRange' },
        ],
        service_provider_search: [
          'Search service providers',
          { text: ', named', field: 'spNames' },
          { text: ', of type', field: 'spType' },
          { text: ', in', field: 'spCountry' },
          { text: ', on deals closed', field: 'spDealDate' },
        ],
        service_provider_bio: [
          {
            text: 'Fetch the PitchBook profile for service provider',
            field: 'serviceProviderId',
            core: true,
          },
        ],
        serviced_companies: [
          {
            text: 'List the companies served by service provider',
            field: 'serviceProviderId',
            core: true,
          },
        ],
        serviced_deals: [
          {
            text: 'List the deals worked on by service provider',
            field: 'serviceProviderId',
            core: true,
          },
        ],
        serviced_investors: [
          {
            text: 'List the investors served by service provider',
            field: 'serviceProviderId',
            core: true,
          },
        ],
        serviced_funds: [
          {
            text: 'List the funds served by service provider',
            field: 'serviceProviderId',
            core: true,
          },
        ],
        serviced_limited_partners: [
          {
            text: 'List the limited partners served by service provider',
            field: 'serviceProviderId',
            core: true,
          },
        ],
        service_provider_updates: [
          {
            text: 'Check what changed on service provider',
            field: 'serviceProviderId',
            core: true,
          },
          { text: ', since', field: 'sinceDate' },
          { text: ', over the last', field: 'trailingRange' },
        ],
        credit_news_search: [
          'Search credit news',
          { text: ', by', field: 'newsAuthors' },
          { text: ', covering', field: 'newsRegions' },
          { text: ', on', field: 'newsTopics' },
          { text: ', published', field: 'sinceDate' },
        ],
        credit_news_most_recent: ['Fetch the most recent credit news articles'],
        credit_news: [{ text: 'Fetch credit news article', field: 'articleId', core: true }],
        credit_news_bulk: [
          { text: 'Fetch the credit news articles', field: 'articleIds', core: true },
        ],
        contracts_history: [
          'List the API contracts on the account',
          { text: ', showing', field: 'contractFilter' },
        ],
        credit_history: [
          'Fetch API credit usage',
          { text: ', since', field: 'sinceDate' },
          { text: ', over the last', field: 'trailingRange' },
        ],
        usage_report: [
          'Fetch the API usage report',
          { text: ', since', field: 'sinceDate' },
          { text: ', over the last', field: 'trailingRange' },
        ],
        cost_of_calls: [
          'Fetch the credit cost of each endpoint',
          { text: ', priced as', field: 'pricingModel' },
        ],
        lookup_table_structure: ['List the lookup tables behind the search filters'],
        lookup_tables: [
          { text: 'Fetch the codes in lookup table', field: 'tableNames', core: true },
        ],
        sandbox_entities: [
          { text: 'List the sandbox entities of type', field: 'sandboxEntityType', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search All Entities', id: 'search' },
        { label: 'Shared Search', id: 'shared_search' },
        { label: 'Get Entity People', id: 'entity_people' },
        { label: 'Get Entity Locations', id: 'entity_locations' },
        { label: 'Get Entity Affiliates', id: 'entity_affiliates' },
        { label: 'Get Entity News', id: 'entity_news' },
        { label: 'Get Entity Updates', id: 'entity_updates' },
        { label: 'Search Companies', id: 'company_search' },
        { label: 'Get Company Bio', id: 'company_bio' },
        { label: 'Get Company Industries', id: 'company_industries' },
        { label: 'Get Company Investors', id: 'company_investors' },
        { label: 'Get Company Active Investors', id: 'company_active_investors' },
        { label: 'Get Company Deals', id: 'company_deals' },
        { label: 'Get Company Latest Financing', id: 'company_most_recent_financing' },
        { label: 'Get Company Latest Debt Financing', id: 'company_most_recent_debt_financing' },
        { label: 'Get Company Latest Financials', id: 'company_most_recent_financials' },
        { label: 'Get Company Financials History', id: 'company_financials' },
        { label: 'Get Similar Companies', id: 'company_similar_companies' },
        { label: 'Get VC Exit Predictions', id: 'company_vc_exit_predictions' },
        { label: 'Get Company Social Analytics', id: 'company_social_analytics' },
        { label: 'Get Company Service Providers', id: 'company_general_service_providers' },
        { label: 'Get Company Deal Service Providers', id: 'company_deal_service_providers' },
        { label: 'Get Company Updates', id: 'company_updates' },
        { label: 'Search Company Patents', id: 'patent_search' },
        { label: 'Get Patent Detail', id: 'patent_detailed' },
        { label: 'Search Deals', id: 'deal_search' },
        { label: 'Get Deal Bio', id: 'deal_bio' },
        { label: 'Get Deal Detail', id: 'deal_detailed' },
        { label: 'Get Deal Valuation', id: 'deal_valuation' },
        { label: 'Get Deal Multiples', id: 'deal_multiples' },
        { label: 'Get Deal Investors', id: 'deal_investors' },
        { label: 'Get Deal Stock Info', id: 'deal_stock_info' },
        { label: 'Get Deal Cap Table', id: 'deal_cap_table_history' },
        { label: 'Get Deal Tranches', id: 'deal_tranche_info' },
        { label: 'Get Deal Debt and Lenders', id: 'deal_debt_lenders' },
        { label: 'Get Deal Service Providers', id: 'deal_service_providers' },
        { label: 'Get Deal Updates', id: 'deal_updates' },
        { label: 'Search Investors', id: 'investor_search' },
        { label: 'Get Investor Bio', id: 'investor_bio' },
        { label: 'Get Investor Investments', id: 'investor_investments' },
        { label: 'Get Investor Active Investments', id: 'investor_active_investments' },
        { label: 'Get Investor Funds', id: 'investor_funds' },
        { label: 'Get Investor Last Closed Fund', id: 'investor_last_closed_fund' },
        { label: 'Get Investor Preferences', id: 'investor_preferences' },
        { label: 'Get Investor Board Seats', id: 'investor_board_seats' },
        { label: 'Get Investor Service Providers', id: 'investor_general_service_providers' },
        { label: 'Get Investor Deal Service Providers', id: 'investor_deal_service_providers' },
        { label: 'Get Investor Updates', id: 'investor_updates' },
        { label: 'Search People', id: 'people_search' },
        { label: 'Get Person Bio', id: 'person_bio' },
        { label: 'Get Person Contact', id: 'person_contact' },
        { label: 'Get Person History', id: 'person_education_work' },
        { label: 'Search Funds', id: 'fund_search' },
        { label: 'Get Fund Bio', id: 'fund_bio' },
        { label: 'Get Fund Performance', id: 'fund_performance' },
        { label: 'Get Fund Benchmark', id: 'fund_benchmark' },
        { label: 'Get Fund Cash Flows', id: 'fund_cash_flows' },
        { label: 'Get Fund Investments', id: 'fund_investments' },
        { label: 'Get Fund Active Investments', id: 'fund_active_investments' },
        { label: 'Get Fund Commitments', id: 'fund_commitments' },
        { label: 'Get Fund Preferences', id: 'fund_investment_preferences' },
        { label: 'Get Fund Team', id: 'fund_team' },
        { label: 'Get Fund Updates', id: 'fund_updates' },
        { label: 'Search Limited Partners', id: 'limited_partner_search' },
        { label: 'Get Limited Partner Bio', id: 'limited_partner_bio' },
        { label: 'Get LP Commitments', id: 'limited_partner_commitments_detailed' },
        { label: 'Get LP Commitment Totals', id: 'limited_partner_commitment_aggregates' },
        { label: 'Get LP Commitment Preferences', id: 'limited_partner_commitment_preferences' },
        { label: 'Get LP Actual Allocations', id: 'limited_partner_actual_allocations' },
        { label: 'Get LP Target Allocations', id: 'limited_partner_target_allocations' },
        { label: 'Get LP Service Providers', id: 'limited_partner_service_providers' },
        { label: 'Get LP Updates', id: 'limited_partner_updates' },
        { label: 'Search Service Providers', id: 'service_provider_search' },
        { label: 'Get Service Provider Bio', id: 'service_provider_bio' },
        { label: 'Get Serviced Companies', id: 'serviced_companies' },
        { label: 'Get Serviced Deals', id: 'serviced_deals' },
        { label: 'Get Serviced Investors', id: 'serviced_investors' },
        { label: 'Get Serviced Funds', id: 'serviced_funds' },
        { label: 'Get Serviced Limited Partners', id: 'serviced_limited_partners' },
        { label: 'Get Service Provider Updates', id: 'service_provider_updates' },
        { label: 'Search Credit News', id: 'credit_news_search' },
        { label: 'Get Recent Credit News', id: 'credit_news_most_recent' },
        { label: 'Get Credit News Article', id: 'credit_news' },
        { label: 'Get Credit News Articles in Bulk', id: 'credit_news_bulk' },
        { label: 'Get Contracts History', id: 'contracts_history' },
        { label: 'Get Credit History', id: 'credit_history' },
        { label: 'Get Usage Report', id: 'usage_report' },
        { label: 'Get Cost of Calls', id: 'cost_of_calls' },
        { label: 'List Lookup Tables', id: 'lookup_table_structure' },
        { label: 'Get Lookup Table Codes', id: 'lookup_tables' },
        { label: 'List Sandbox Entities', id: 'sandbox_entities' },
      ],
      value: () => 'search',
    },
    {
      id: 'apiKey',
      title: 'PitchBook API Key',
      type: 'short-input',
      placeholder: 'Enter your PitchBook API key',
      password: true,
      required: true,
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Databricks, a website, or a PitchBook ID',
      condition: { field: 'operation', value: 'search' },
      required: { field: 'operation', value: 'search' },
    },
    {
      id: 'companyId',
      title: 'PitchBook Company ID',
      type: 'short-input',
      placeholder: '10618-03',
      condition: {
        field: 'operation',
        value: [
          'company_active_investors',
          'company_bio',
          'company_deal_service_providers',
          'company_deals',
          'company_financials',
          'company_general_service_providers',
          'company_industries',
          'company_investors',
          'company_most_recent_debt_financing',
          'company_most_recent_financials',
          'company_most_recent_financing',
          'company_similar_companies',
          'company_social_analytics',
          'company_updates',
          'company_vc_exit_predictions',
          'patent_search',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'company_active_investors',
          'company_bio',
          'company_deal_service_providers',
          'company_deals',
          'company_financials',
          'company_general_service_providers',
          'company_industries',
          'company_investors',
          'company_most_recent_debt_financing',
          'company_most_recent_financials',
          'company_most_recent_financing',
          'company_similar_companies',
          'company_social_analytics',
          'company_updates',
          'company_vc_exit_predictions',
          'patent_search',
        ],
      },
    },
    {
      id: 'dealId',
      title: 'PitchBook Deal ID',
      type: 'short-input',
      placeholder: '52721-65T',
      condition: {
        field: 'operation',
        value: [
          'deal_bio',
          'deal_cap_table_history',
          'deal_debt_lenders',
          'deal_detailed',
          'deal_investors',
          'deal_multiples',
          'deal_service_providers',
          'deal_stock_info',
          'deal_tranche_info',
          'deal_updates',
          'deal_valuation',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'deal_bio',
          'deal_cap_table_history',
          'deal_debt_lenders',
          'deal_detailed',
          'deal_investors',
          'deal_multiples',
          'deal_service_providers',
          'deal_stock_info',
          'deal_tranche_info',
          'deal_updates',
          'deal_valuation',
        ],
      },
    },
    {
      id: 'investorId',
      title: 'PitchBook Investor ID',
      type: 'short-input',
      placeholder: '58781-35',
      condition: {
        field: 'operation',
        value: [
          'investor_active_investments',
          'investor_bio',
          'investor_board_seats',
          'investor_deal_service_providers',
          'investor_funds',
          'investor_general_service_providers',
          'investor_investments',
          'investor_last_closed_fund',
          'investor_preferences',
          'investor_updates',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'investor_active_investments',
          'investor_bio',
          'investor_board_seats',
          'investor_deal_service_providers',
          'investor_funds',
          'investor_general_service_providers',
          'investor_investments',
          'investor_last_closed_fund',
          'investor_preferences',
          'investor_updates',
        ],
      },
    },
    {
      id: 'personId',
      title: 'PitchBook Person ID',
      type: 'short-input',
      placeholder: '53503-66P',
      condition: {
        field: 'operation',
        value: ['person_bio', 'person_contact', 'person_education_work'],
      },
      required: {
        field: 'operation',
        value: ['person_bio', 'person_contact', 'person_education_work'],
      },
    },
    {
      id: 'fundId',
      title: 'PitchBook Fund ID',
      type: 'short-input',
      placeholder: '11373-13F',
      condition: {
        field: 'operation',
        value: [
          'fund_active_investments',
          'fund_benchmark',
          'fund_bio',
          'fund_cash_flows',
          'fund_commitments',
          'fund_investment_preferences',
          'fund_investments',
          'fund_performance',
          'fund_team',
          'fund_updates',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'fund_active_investments',
          'fund_benchmark',
          'fund_bio',
          'fund_cash_flows',
          'fund_commitments',
          'fund_investment_preferences',
          'fund_investments',
          'fund_performance',
          'fund_team',
          'fund_updates',
        ],
      },
    },
    {
      id: 'limitedPartnerId',
      title: 'PitchBook Limited Partner ID',
      type: 'short-input',
      placeholder: '58901-50',
      condition: {
        field: 'operation',
        value: [
          'limited_partner_actual_allocations',
          'limited_partner_bio',
          'limited_partner_commitment_aggregates',
          'limited_partner_commitment_preferences',
          'limited_partner_commitments_detailed',
          'limited_partner_service_providers',
          'limited_partner_target_allocations',
          'limited_partner_updates',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'limited_partner_actual_allocations',
          'limited_partner_bio',
          'limited_partner_commitment_aggregates',
          'limited_partner_commitment_preferences',
          'limited_partner_commitments_detailed',
          'limited_partner_service_providers',
          'limited_partner_target_allocations',
          'limited_partner_updates',
        ],
      },
    },
    {
      id: 'serviceProviderId',
      title: 'PitchBook Service Provider ID',
      type: 'short-input',
      placeholder: '11356-75',
      condition: {
        field: 'operation',
        value: [
          'service_provider_bio',
          'service_provider_updates',
          'serviced_companies',
          'serviced_deals',
          'serviced_funds',
          'serviced_investors',
          'serviced_limited_partners',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'service_provider_bio',
          'service_provider_updates',
          'serviced_companies',
          'serviced_deals',
          'serviced_funds',
          'serviced_investors',
          'serviced_limited_partners',
        ],
      },
    },
    {
      id: 'entityId',
      title: 'PitchBook Entity ID',
      type: 'short-input',
      placeholder: '51261-67',
      condition: {
        field: 'operation',
        value: [
          'entity_affiliates',
          'entity_locations',
          'entity_news',
          'entity_people',
          'entity_updates',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'entity_affiliates',
          'entity_locations',
          'entity_news',
          'entity_people',
          'entity_updates',
        ],
      },
    },
    {
      id: 'patentId',
      title: 'PitchBook Patent ID',
      type: 'short-input',
      placeholder: 'EP-3167426-B1',
      condition: { field: 'operation', value: 'patent_detailed' },
      required: { field: 'operation', value: 'patent_detailed' },
    },
    {
      id: 'articleId',
      title: 'PitchBook Credit News Article ID',
      type: 'short-input',
      placeholder: '1312103',
      condition: { field: 'operation', value: 'credit_news' },
      required: { field: 'operation', value: 'credit_news' },
    },
    {
      id: 'coNames',
      title: 'Company Names',
      type: 'short-input',
      placeholder: 'Databricks, Stripe',
      condition: { field: 'operation', value: 'company_search' },
    },
    {
      id: 'coKeywords',
      title: 'Keywords',
      type: 'short-input',
      placeholder: 'artificial intelligence',
      condition: { field: 'operation', value: 'company_search' },
    },
    {
      id: 'coCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'USA',
      condition: { field: 'operation', value: 'company_search' },
      mode: 'advanced',
    },
    {
      id: 'coIndustry',
      title: 'Industry Code',
      type: 'short-input',
      placeholder: '605010',
      condition: { field: 'operation', value: 'company_search' },
      mode: 'advanced',
    },
    {
      id: 'coVerticals',
      title: 'Vertical Code',
      type: 'short-input',
      placeholder: 'AIML',
      condition: { field: 'operation', value: 'company_search' },
      mode: 'advanced',
    },
    {
      id: 'coDealType',
      title: 'Deal Type',
      type: 'short-input',
      placeholder: 'evc',
      condition: { field: 'operation', value: 'company_search' },
      mode: 'advanced',
    },
    {
      id: 'coDealDate',
      title: 'Deal Date',
      type: 'short-input',
      placeholder: '>2023-01-01',
      condition: { field: 'operation', value: 'company_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook date filter. The operator is part of the value: ">YYYY-MM-DD" for after a date, "<YYYY-MM-DD" for before one, and "YYYY-MM-DD^YYYY-MM-DD" for a range. Return ONLY the filter string - no explanations, no extra text.',
        generationType: 'timestamp',
        placeholder: 'Describe the time window, e.g. "in the last two years"',
      },
    },
    {
      id: 'coDealSize',
      title: 'Deal Size (millions)',
      type: 'short-input',
      placeholder: '>50',
      condition: { field: 'operation', value: 'company_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook numeric range filter. The operator is part of the value: ">100" for greater than, "<100" for less than, and "10^100" for a range. Return ONLY the filter string - no explanations, no extra text.',
        placeholder: 'Describe the range, e.g. "between 10 and 100 million"',
      },
    },
    {
      id: 'coTotalRaised',
      title: 'Total Raised (millions)',
      type: 'short-input',
      placeholder: '>100',
      condition: { field: 'operation', value: 'company_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook numeric range filter. The operator is part of the value: ">100" for greater than, "<100" for less than, and "10^100" for a range. Return ONLY the filter string - no explanations, no extra text.',
        placeholder: 'Describe the range, e.g. "between 10 and 100 million"',
      },
    },
    {
      id: 'coEmployeeCount',
      title: 'Employee Count',
      type: 'short-input',
      placeholder: '100^500',
      condition: { field: 'operation', value: 'company_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook numeric range filter. The operator is part of the value: ">100" for greater than, "<100" for less than, and "10^100" for a range. Return ONLY the filter string - no explanations, no extra text.',
        placeholder: 'Describe the range, e.g. "between 10 and 100 million"',
      },
    },
    {
      id: 'coInvestorNames',
      title: 'Investor Names',
      type: 'short-input',
      placeholder: 'Sequoia Capital',
      condition: { field: 'operation', value: 'company_search' },
      mode: 'advanced',
    },
    {
      id: 'dealCompanyNames',
      title: 'Company Names',
      type: 'short-input',
      placeholder: 'Databricks',
      condition: { field: 'operation', value: 'deal_search' },
    },
    {
      id: 'dealInvestorNames',
      title: 'Investor Names',
      type: 'short-input',
      placeholder: 'Sequoia Capital',
      condition: { field: 'operation', value: 'deal_search' },
    },
    {
      id: 'dealTypeFilter',
      title: 'Deal Type',
      type: 'short-input',
      placeholder: 'evc',
      condition: { field: 'operation', value: 'deal_search' },
      mode: 'advanced',
    },
    {
      id: 'dealStatusFilter',
      title: 'Deal Status',
      type: 'short-input',
      placeholder: 'COMP',
      condition: { field: 'operation', value: 'deal_search' },
      mode: 'advanced',
    },
    {
      id: 'dealSizeFilter',
      title: 'Deal Size (millions)',
      type: 'short-input',
      placeholder: '>50',
      condition: { field: 'operation', value: 'deal_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook numeric range filter. The operator is part of the value: ">100" for greater than, "<100" for less than, and "10^100" for a range. Return ONLY the filter string - no explanations, no extra text.',
        placeholder: 'Describe the range, e.g. "between 10 and 100 million"',
      },
    },
    {
      id: 'dealDateFilter',
      title: 'Deal Date',
      type: 'short-input',
      placeholder: '>2023-01-01',
      condition: { field: 'operation', value: 'deal_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook date filter. The operator is part of the value: ">YYYY-MM-DD" for after a date, "<YYYY-MM-DD" for before one, and "YYYY-MM-DD^YYYY-MM-DD" for a range. Return ONLY the filter string - no explanations, no extra text.',
        generationType: 'timestamp',
        placeholder: 'Describe the time window, e.g. "in the last two years"',
      },
    },
    {
      id: 'dealCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'USA',
      condition: { field: 'operation', value: 'deal_search' },
      mode: 'advanced',
    },
    {
      id: 'dealIndustry',
      title: 'Industry Code',
      type: 'short-input',
      placeholder: '605010',
      condition: { field: 'operation', value: 'deal_search' },
      mode: 'advanced',
    },
    {
      id: 'invNames',
      title: 'Investor Names',
      type: 'short-input',
      placeholder: 'Sequoia Capital',
      condition: { field: 'operation', value: 'investor_search' },
    },
    {
      id: 'invType',
      title: 'Investor Type',
      type: 'short-input',
      placeholder: 'VC',
      condition: { field: 'operation', value: 'investor_search' },
    },
    {
      id: 'invCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'USA',
      condition: { field: 'operation', value: 'investor_search' },
      mode: 'advanced',
    },
    {
      id: 'invAum',
      title: 'Assets Under Management (millions)',
      type: 'short-input',
      placeholder: '>1000',
      condition: { field: 'operation', value: 'investor_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook numeric range filter. The operator is part of the value: ">100" for greater than, "<100" for less than, and "10^100" for a range. Return ONLY the filter string - no explanations, no extra text.',
        placeholder: 'Describe the range, e.g. "between 10 and 100 million"',
      },
    },
    {
      id: 'invDryPowder',
      title: 'Dry Powder (millions)',
      type: 'short-input',
      placeholder: '1^500',
      condition: { field: 'operation', value: 'investor_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook numeric range filter. The operator is part of the value: ">100" for greater than, "<100" for less than, and "10^100" for a range. Return ONLY the filter string - no explanations, no extra text.',
        placeholder: 'Describe the range, e.g. "between 10 and 100 million"',
      },
    },
    {
      id: 'invDealType',
      title: 'Deal Type',
      type: 'short-input',
      placeholder: 'evc',
      condition: { field: 'operation', value: 'investor_search' },
      mode: 'advanced',
    },
    {
      id: 'invDealDate',
      title: 'Deal Date',
      type: 'short-input',
      placeholder: '>2023-01-01',
      condition: { field: 'operation', value: 'investor_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook date filter. The operator is part of the value: ">YYYY-MM-DD" for after a date, "<YYYY-MM-DD" for before one, and "YYYY-MM-DD^YYYY-MM-DD" for a range. Return ONLY the filter string - no explanations, no extra text.',
        generationType: 'timestamp',
        placeholder: 'Describe the time window, e.g. "in the last two years"',
      },
    },
    {
      id: 'pplNames',
      title: 'Person Names',
      type: 'short-input',
      placeholder: 'Jane Trust',
      condition: { field: 'operation', value: 'people_search' },
    },
    {
      id: 'pplFirstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Jane',
      condition: { field: 'operation', value: 'people_search' },
      mode: 'advanced',
    },
    {
      id: 'pplLastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Trust',
      condition: { field: 'operation', value: 'people_search' },
      mode: 'advanced',
    },
    {
      id: 'pplFirmNames',
      title: 'Firm Names',
      type: 'short-input',
      placeholder: 'Databricks',
      condition: { field: 'operation', value: 'people_search' },
    },
    {
      id: 'pplPositionLevel',
      title: 'Position Level',
      type: 'short-input',
      placeholder: 'CEO, CFO',
      condition: { field: 'operation', value: 'people_search' },
      mode: 'advanced',
    },
    {
      id: 'pplPositionTitle',
      title: 'Position Title',
      type: 'short-input',
      placeholder: 'Chief Executive Officer',
      condition: { field: 'operation', value: 'people_search' },
      mode: 'advanced',
    },
    {
      id: 'pplCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'USA',
      condition: { field: 'operation', value: 'people_search' },
      mode: 'advanced',
    },
    {
      id: 'fundNames',
      title: 'Fund Names',
      type: 'short-input',
      placeholder: 'Accel V',
      condition: { field: 'operation', value: 'fund_search' },
    },
    {
      id: 'fundInvestorNames',
      title: 'Fund Manager Names',
      type: 'short-input',
      placeholder: 'Accel',
      condition: { field: 'operation', value: 'fund_search' },
    },
    {
      id: 'fundTypeFilter',
      title: 'Fund Type',
      type: 'short-input',
      placeholder: 'VC',
      condition: { field: 'operation', value: 'fund_search' },
      mode: 'advanced',
    },
    {
      id: 'fundSizeFilter',
      title: 'Fund Size (millions)',
      type: 'short-input',
      placeholder: '1^5000',
      condition: { field: 'operation', value: 'fund_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook numeric range filter. The operator is part of the value: ">100" for greater than, "<100" for less than, and "10^100" for a range. Return ONLY the filter string - no explanations, no extra text.',
        placeholder: 'Describe the range, e.g. "between 10 and 100 million"',
      },
    },
    {
      id: 'fundVintage',
      title: 'Vintage Year',
      type: 'short-input',
      placeholder: '>2015',
      condition: { field: 'operation', value: 'fund_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook numeric range filter. The operator is part of the value: ">100" for greater than, "<100" for less than, and "10^100" for a range. Return ONLY the filter string - no explanations, no extra text.',
        placeholder: 'Describe the range, e.g. "between 10 and 100 million"',
      },
    },
    {
      id: 'fundCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'USA',
      condition: { field: 'operation', value: 'fund_search' },
      mode: 'advanced',
    },
    {
      id: 'fundIrr',
      title: 'IRR (percent)',
      type: 'short-input',
      placeholder: '>20',
      condition: { field: 'operation', value: 'fund_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook numeric range filter. The operator is part of the value: ">100" for greater than, "<100" for less than, and "10^100" for a range. Return ONLY the filter string - no explanations, no extra text.',
        placeholder: 'Describe the range, e.g. "between 10 and 100 million"',
      },
    },
    {
      id: 'lpNames',
      title: 'Limited Partner Names',
      type: 'short-input',
      placeholder: 'Yale University',
      condition: { field: 'operation', value: 'limited_partner_search' },
    },
    {
      id: 'lpType',
      title: 'Limited Partner Type',
      type: 'short-input',
      placeholder: 'CPF',
      condition: { field: 'operation', value: 'limited_partner_search' },
    },
    {
      id: 'lpCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'USA',
      condition: { field: 'operation', value: 'limited_partner_search' },
      mode: 'advanced',
    },
    {
      id: 'lpAum',
      title: 'Assets Under Management (millions)',
      type: 'short-input',
      placeholder: '>1000',
      condition: { field: 'operation', value: 'limited_partner_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook numeric range filter. The operator is part of the value: ">100" for greater than, "<100" for less than, and "10^100" for a range. Return ONLY the filter string - no explanations, no extra text.',
        placeholder: 'Describe the range, e.g. "between 10 and 100 million"',
      },
    },
    {
      id: 'lpNumCommitments',
      title: 'Number of Commitments',
      type: 'short-input',
      placeholder: '>100',
      condition: { field: 'operation', value: 'limited_partner_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook numeric range filter. The operator is part of the value: ">100" for greater than, "<100" for less than, and "10^100" for a range. Return ONLY the filter string - no explanations, no extra text.',
        placeholder: 'Describe the range, e.g. "between 10 and 100 million"',
      },
    },
    {
      id: 'spNames',
      title: 'Service Provider Names',
      type: 'short-input',
      placeholder: 'Goodwin Procter',
      condition: { field: 'operation', value: 'service_provider_search' },
    },
    {
      id: 'spType',
      title: 'Service Provider Type',
      type: 'short-input',
      placeholder: 'LAW',
      condition: { field: 'operation', value: 'service_provider_search' },
    },
    {
      id: 'spCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'USA',
      condition: { field: 'operation', value: 'service_provider_search' },
      mode: 'advanced',
    },
    {
      id: 'spDealType',
      title: 'Deal Type',
      type: 'short-input',
      placeholder: 'evc',
      condition: { field: 'operation', value: 'service_provider_search' },
      mode: 'advanced',
    },
    {
      id: 'spDealDate',
      title: 'Deal Date',
      type: 'short-input',
      placeholder: '>2020-07-20',
      condition: { field: 'operation', value: 'service_provider_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook date filter. The operator is part of the value: ">YYYY-MM-DD" for after a date, "<YYYY-MM-DD" for before one, and "YYYY-MM-DD^YYYY-MM-DD" for a range. Return ONLY the filter string - no explanations, no extra text.',
        generationType: 'timestamp',
        placeholder: 'Describe the time window, e.g. "in the last two years"',
      },
    },
    {
      id: 'trailingRange',
      title: 'Trailing Days',
      type: 'short-input',
      placeholder: '20',
      condition: {
        field: 'operation',
        value: [
          'entity_news',
          'entity_updates',
          'company_updates',
          'deal_updates',
          'investor_updates',
          'fund_updates',
          'limited_partner_updates',
          'service_provider_updates',
          'credit_history',
          'usage_report',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'sinceDate',
      title: 'Since Date',
      type: 'short-input',
      placeholder: '>2024-01-01',
      condition: {
        field: 'operation',
        value: [
          'entity_news',
          'entity_updates',
          'company_updates',
          'deal_updates',
          'investor_updates',
          'fund_updates',
          'limited_partner_updates',
          'service_provider_updates',
          'credit_history',
          'usage_report',
          'credit_news_search',
        ],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook date filter. The operator is part of the value: ">YYYY-MM-DD" for after a date, "<YYYY-MM-DD" for before one, and "YYYY-MM-DD^YYYY-MM-DD" for a range. Return ONLY the filter string - no explanations, no extra text.',
        generationType: 'timestamp',
        placeholder: 'Describe the time window, e.g. "in the last two years"',
      },
    },
    {
      id: 'compare',
      title: 'Compare Against',
      type: 'short-input',
      placeholder: 'SIMILAR_COMPANIES',
      condition: { field: 'operation', value: 'company_social_analytics' },
      mode: 'advanced',
    },
    {
      id: 'period',
      title: 'Reporting Quarter',
      type: 'short-input',
      placeholder: '4Q2018',
      condition: { field: 'operation', value: 'fund_cash_flows' },
      required: { field: 'operation', value: 'fund_cash_flows' },
    },
    {
      id: 'patentStatus',
      title: 'Patent Status',
      type: 'short-input',
      placeholder: 'Active',
      condition: { field: 'operation', value: 'patent_search' },
    },
    {
      id: 'patentPublicationDate',
      title: 'Publication Date',
      type: 'short-input',
      placeholder: '>2020-01-01',
      condition: { field: 'operation', value: 'patent_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook date filter. The operator is part of the value: ">YYYY-MM-DD" for after a date, "<YYYY-MM-DD" for before one, and "YYYY-MM-DD^YYYY-MM-DD" for a range. Return ONLY the filter string - no explanations, no extra text.',
        generationType: 'timestamp',
        placeholder: 'Describe the time window, e.g. "in the last two years"',
      },
    },
    {
      id: 'patentFirstFilingDate',
      title: 'First Filing Date',
      type: 'short-input',
      placeholder: '>2015-01-01',
      condition: { field: 'operation', value: 'patent_search' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a PitchBook date filter. The operator is part of the value: ">YYYY-MM-DD" for after a date, "<YYYY-MM-DD" for before one, and "YYYY-MM-DD^YYYY-MM-DD" for a range. Return ONLY the filter string - no explanations, no extra text.',
        generationType: 'timestamp',
        placeholder: 'Describe the time window, e.g. "in the last two years"',
      },
    },
    {
      id: 'patentFilingAuthority',
      title: 'Filing Authority',
      type: 'short-input',
      placeholder: 'EP',
      condition: { field: 'operation', value: 'patent_search' },
      mode: 'advanced',
    },
    {
      id: 'patentCpcSectionCode',
      title: 'CPC Section Code',
      type: 'short-input',
      placeholder: 'G',
      condition: { field: 'operation', value: 'patent_search' },
      mode: 'advanced',
    },
    {
      id: 'patentCpcClassCode',
      title: 'CPC Class Code',
      type: 'short-input',
      placeholder: 'G08',
      condition: { field: 'operation', value: 'patent_search' },
      mode: 'advanced',
    },
    {
      id: 'newsAuthors',
      title: 'Authors',
      type: 'short-input',
      placeholder: 'Sean Czarnecki',
      condition: { field: 'operation', value: 'credit_news_search' },
      mode: 'advanced',
    },
    {
      id: 'newsRegions',
      title: 'Regions',
      type: 'short-input',
      placeholder: 'United States',
      condition: { field: 'operation', value: 'credit_news_search' },
    },
    {
      id: 'newsAssetClasses',
      title: 'Asset Classes',
      type: 'short-input',
      placeholder: 'Distressed',
      condition: { field: 'operation', value: 'credit_news_search' },
      mode: 'advanced',
    },
    {
      id: 'newsTopics',
      title: 'Topics',
      type: 'short-input',
      placeholder: 'People',
      condition: { field: 'operation', value: 'credit_news_search' },
      mode: 'advanced',
    },
    {
      id: 'newsIssuer',
      title: 'Issuer',
      type: 'short-input',
      placeholder: 'Sound Physicians',
      condition: { field: 'operation', value: 'credit_news_search' },
      mode: 'advanced',
    },
    {
      id: 'newsLender',
      title: 'Lender',
      type: 'short-input',
      placeholder: 'Blackstone Credit',
      condition: { field: 'operation', value: 'credit_news_search' },
      mode: 'advanced',
    },
    {
      id: 'newsSponsor',
      title: 'Sponsor',
      type: 'short-input',
      placeholder: 'Summit Partners',
      condition: { field: 'operation', value: 'credit_news_search' },
      mode: 'advanced',
    },
    {
      id: 'pricingModel',
      title: 'Pricing Model',
      type: 'short-input',
      placeholder: 'SUBSCRIPTION',
      condition: { field: 'operation', value: 'cost_of_calls' },
    },
    {
      id: 'tableNames',
      title: 'Lookup Table Names',
      type: 'short-input',
      placeholder: 'INDUSTRY',
      condition: { field: 'operation', value: 'lookup_tables' },
      required: { field: 'operation', value: 'lookup_tables' },
    },
    {
      id: 'sandboxEntityType',
      title: 'Entity Type',
      type: 'short-input',
      placeholder: 'COMPANIES',
      condition: { field: 'operation', value: 'sandbox_entities' },
      required: { field: 'operation', value: 'sandbox_entities' },
    },
    {
      id: 'sharedEntityType',
      title: 'Entity Type',
      type: 'short-input',
      placeholder: 'COMPANIES',
      condition: { field: 'operation', value: 'shared_search' },
      required: { field: 'operation', value: 'shared_search' },
    },
    {
      id: 'searchId',
      title: 'Shared Search ID',
      type: 'short-input',
      placeholder: '8e6bd17e-dea5-4eca-8143-dddb2ab623a0',
      condition: { field: 'operation', value: 'shared_search' },
      required: { field: 'operation', value: 'shared_search' },
    },
    {
      id: 'hash',
      title: 'Shared Search Hash',
      type: 'short-input',
      placeholder: '484124ea029982f76ec42f9a53cb345...',
      condition: { field: 'operation', value: 'shared_search' },
      required: { field: 'operation', value: 'shared_search' },
    },
    {
      id: 'contractFilter',
      title: 'Contracts To Return',
      type: 'dropdown',
      options: [
        { label: 'All contracts', id: 'all' },
        { label: 'Active only', id: 'active' },
        { label: 'Past only', id: 'past' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'contracts_history' },
      mode: 'advanced',
    },
    {
      id: 'articleIds',
      title: 'Article IDs',
      canvasNoun: 'a list of article IDs',
      type: 'code',
      placeholder: '[11041384, 2142401, 5302402]',
      condition: { field: 'operation', value: 'credit_news_bulk' },
      required: { field: 'operation', value: 'credit_news_bulk' },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: {
        field: 'operation',
        value: [
          'search',
          'shared_search',
          'company_search',
          'deal_search',
          'investor_search',
          'people_search',
          'fund_search',
          'limited_partner_search',
          'service_provider_search',
          'patent_search',
          'credit_news_search',
          'credit_news_most_recent',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'perPage',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: '25',
      condition: {
        field: 'operation',
        value: [
          'search',
          'shared_search',
          'company_search',
          'deal_search',
          'investor_search',
          'people_search',
          'fund_search',
          'limited_partner_search',
          'service_provider_search',
          'patent_search',
          'credit_news_search',
          'credit_news_most_recent',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'additionalFilters',
      title: 'Additional Filters',
      canvasNoun: 'extra filters',
      type: 'code',
      placeholder: '{"emergingSpaces": "AGTECH", "locationType": "HQ_ONLY"}',
      condition: {
        field: 'operation',
        value: [
          'company_search',
          'deal_search',
          'investor_search',
          'people_search',
          'fund_search',
          'limited_partner_search',
          'service_provider_search',
        ],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of PitchBook search query parameters and values. Range filters carry their operator in the value, such as ">2023-01-01" or "1^500". Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'currency',
      title: 'Currency',
      type: 'short-input',
      placeholder: 'USD',
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'pitchbook_search',
      'pitchbook_shared_search',
      'pitchbook_entity_people',
      'pitchbook_entity_locations',
      'pitchbook_entity_affiliates',
      'pitchbook_entity_news',
      'pitchbook_entity_updates',
      'pitchbook_company_search',
      'pitchbook_company_bio',
      'pitchbook_company_industries',
      'pitchbook_company_investors',
      'pitchbook_company_active_investors',
      'pitchbook_company_deals',
      'pitchbook_company_most_recent_financing',
      'pitchbook_company_most_recent_debt_financing',
      'pitchbook_company_most_recent_financials',
      'pitchbook_company_financials',
      'pitchbook_company_similar_companies',
      'pitchbook_company_vc_exit_predictions',
      'pitchbook_company_social_analytics',
      'pitchbook_company_general_service_providers',
      'pitchbook_company_deal_service_providers',
      'pitchbook_company_updates',
      'pitchbook_patent_search',
      'pitchbook_patent_detailed',
      'pitchbook_deal_search',
      'pitchbook_deal_bio',
      'pitchbook_deal_detailed',
      'pitchbook_deal_valuation',
      'pitchbook_deal_multiples',
      'pitchbook_deal_investors',
      'pitchbook_deal_stock_info',
      'pitchbook_deal_cap_table_history',
      'pitchbook_deal_tranche_info',
      'pitchbook_deal_debt_lenders',
      'pitchbook_deal_service_providers',
      'pitchbook_deal_updates',
      'pitchbook_investor_search',
      'pitchbook_investor_bio',
      'pitchbook_investor_investments',
      'pitchbook_investor_active_investments',
      'pitchbook_investor_funds',
      'pitchbook_investor_last_closed_fund',
      'pitchbook_investor_preferences',
      'pitchbook_investor_board_seats',
      'pitchbook_investor_general_service_providers',
      'pitchbook_investor_deal_service_providers',
      'pitchbook_investor_updates',
      'pitchbook_people_search',
      'pitchbook_person_bio',
      'pitchbook_person_contact',
      'pitchbook_person_education_work',
      'pitchbook_fund_search',
      'pitchbook_fund_bio',
      'pitchbook_fund_performance',
      'pitchbook_fund_benchmark',
      'pitchbook_fund_cash_flows',
      'pitchbook_fund_investments',
      'pitchbook_fund_active_investments',
      'pitchbook_fund_commitments',
      'pitchbook_fund_investment_preferences',
      'pitchbook_fund_team',
      'pitchbook_fund_updates',
      'pitchbook_limited_partner_search',
      'pitchbook_limited_partner_bio',
      'pitchbook_limited_partner_commitments_detailed',
      'pitchbook_limited_partner_commitment_aggregates',
      'pitchbook_limited_partner_commitment_preferences',
      'pitchbook_limited_partner_actual_allocations',
      'pitchbook_limited_partner_target_allocations',
      'pitchbook_limited_partner_service_providers',
      'pitchbook_limited_partner_updates',
      'pitchbook_service_provider_search',
      'pitchbook_service_provider_bio',
      'pitchbook_serviced_companies',
      'pitchbook_serviced_deals',
      'pitchbook_serviced_investors',
      'pitchbook_serviced_funds',
      'pitchbook_serviced_limited_partners',
      'pitchbook_service_provider_updates',
      'pitchbook_credit_news_search',
      'pitchbook_credit_news_most_recent',
      'pitchbook_credit_news',
      'pitchbook_credit_news_bulk',
      'pitchbook_contracts_history',
      'pitchbook_credit_history',
      'pitchbook_usage_report',
      'pitchbook_cost_of_calls',
      'pitchbook_lookup_table_structure',
      'pitchbook_lookup_tables',
      'pitchbook_sandbox_entities',
    ],
    config: {
      tool: (params) => {
        const operation = params.operation
        if (typeof operation !== 'string' || operation === '') {
          throw new Error('PitchBook operation is required')
        }
        return `pitchbook_${operation}`
      },
      params: (params) => {
        const { additionalFilters, articleIds, page, perPage, trailingRange, ...rest } = params
        const operation = String(params.operation ?? '')
        const mapped: Record<string, unknown> = { ...rest }

        // Collapse only the ID subblock this operation owns onto `pbId`, clearing
        // the rest so a stale one cannot retarget the call (see the map's TSDoc).
        for (const id of ID_SUBBLOCK_IDS) mapped[id] = undefined
        const idSubBlock = ID_SUBBLOCK_FOR_OPERATION[operation]
        const idValue = idSubBlock ? params[idSubBlock] : undefined
        mapped.pbId = typeof idValue === 'string' && idValue !== '' ? idValue : undefined

        // Rename the prefixed filter subblocks onto their PitchBook param names,
        // dropping any that belong to a different operation (see the table's TSDoc).
        for (const [subBlockId, { param, operation: owner }] of Object.entries(
          SEARCH_FIELD_TO_PARAM
        )) {
          const value = mapped[subBlockId]
          mapped[subBlockId] = undefined
          if (owner !== operation) continue
          mapped[param] = value === undefined || value === '' ? undefined : value
        }

        const parseJson = (raw: unknown, label: string): unknown => {
          if (typeof raw !== 'string') return raw
          if (raw.trim() === '') return undefined
          try {
            return JSON.parse(raw)
          } catch (error) {
            throw new Error(`Invalid ${label} JSON: ${getErrorMessage(error)}`)
          }
        }

        mapped.additionalFilters = parseJson(additionalFilters, 'Additional Filters')
        mapped.articleIds = parseJson(articleIds, 'Article IDs')

        // PitchBook's activeContract is tri-state: true is active-only, false is
        // past-only, and omitting it returns every contract. A switch cannot express
        // that third state, so the subblock is a dropdown and 'all' omits the param.
        const contractFilter = mapped.contractFilter
        mapped.contractFilter = undefined
        if (contractFilter === 'active') mapped.activeContract = true
        else if (contractFilter === 'past') mapped.activeContract = false

        // Assign every numeric key unconditionally: a cleared field is '' rather
        // than null, and leaving the key off would let that '' reach the wire.
        mapped.page = toOptionalNumber(page)
        mapped.perPage = toOptionalNumber(perPage)
        mapped.trailingRange = toOptionalNumber(trailingRange)

        return mapped
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'PitchBook operation to perform' },
  },
  outputs: {
    active: {
      type: 'json',
      description: 'Active team members (operations: fund_team)',
    },
    activeCommitmentsInDebtFunds: {
      type: 'json',
      description:
        'Number of active commitments to debt funds (operations: limited_partner_commitment_aggregates)',
    },
    activeCommitmentsInEnergyFunds: {
      type: 'json',
      description:
        'Number of active commitments to energy funds (operations: limited_partner_commitment_aggregates)',
    },
    activeCommitmentsInFoFsAnd2nd: {
      type: 'json',
      description:
        'Number of active commitments to funds of funds and secondaries (operations: limited_partner_commitment_aggregates)',
    },
    activeCommitmentsInInfrastructure: {
      type: 'json',
      description:
        'Number of active commitments to infrastructure funds (operations: limited_partner_commitment_aggregates)',
    },
    activeCommitmentsInOtherFunds: {
      type: 'number',
      description:
        'Number of active commitments to other funds (operations: limited_partner_commitment_aggregates)',
    },
    activeCommitmentsInPeFunds: {
      type: 'number',
      description:
        'Number of active commitments to PE funds (operations: limited_partner_commitment_aggregates)',
    },
    activeCommitmentsInReFunds: {
      type: 'number',
      description:
        'Number of active commitments to real estate funds (operations: limited_partner_commitment_aggregates)',
    },
    activeCommitmentsInVcFunds: {
      type: 'number',
      description:
        'Number of active commitments to VC funds (operations: limited_partner_commitment_aggregates)',
    },
    activeInvestments: {
      type: 'json',
      description:
        'Portfolio positions the fund still holds (operations: fund_active_investments, investor_active_investments)',
    },
    activeInvestors: {
      type: 'json',
      description:
        'Investors currently holding a position in the company (operations: company_active_investors)',
    },
    affiliatedFunds: {
      type: 'number',
      description: 'Number of affiliated funds (operations: limited_partner_actual_allocations)',
    },
    affiliatedInvestors: {
      type: 'number',
      description:
        'Number of affiliated investors (operations: limited_partner_actual_allocations)',
    },
    affiliates: {
      type: 'json',
      description: 'Entities affiliated with the given entity (operations: entity_affiliates)',
    },
    allocations: {
      type: 'json',
      description: 'Reported asset allocations (operations: limited_partner_actual_allocations)',
    },
    alternateOffices: {
      type: 'json',
      description: 'Other offices on record (operations: entity_locations)',
    },
    alternateOfficesCount: {
      type: 'number',
      description: 'How many other offices are on record (operations: entity_locations)',
    },
    antiDilutionProvisions: {
      type: 'string',
      description: 'Anti-dilution provisions (operations: deal_stock_info)',
    },
    applicationDate: {
      type: 'string',
      description: 'Application date (YYYY-MM-DD) (operations: patent_detailed)',
    },
    articleBody: {
      type: 'string',
      description: 'Full text of the article (operations: credit_news)',
    },
    articleId: {
      type: 'number',
      description: 'Credit news article ID (operations: credit_news)',
    },
    asOfQuarter: {
      type: 'number',
      description:
        'Quarter the figures are reported as of (operations: fund_cash_flows, fund_performance)',
    },
    asOfYear: {
      type: 'number',
      description:
        'Year the figures are reported as of (operations: fund_cash_flows, fund_performance)',
    },
    assetClasses: {
      type: 'json',
      description: 'Asset classes the article covers (operations: credit_news)',
    },
    assetPreferences: {
      type: 'json',
      description:
        'Asset classes and subcategories targeted (operations: fund_investment_preferences, investor_preferences)',
    },
    assetsUnderManagement: {
      type: 'json',
      description: 'Assets under management (operations: investor_bio, limited_partner_bio)',
    },
    attachments: {
      type: 'json',
      description: 'Attachments on the article (operations: credit_news)',
    },
    authors: {
      type: 'json',
      description: 'Authors of the article (operations: credit_news)',
    },
    benchmarkFundLocation: {
      type: 'json',
      description: 'Location the benchmark is built from (operations: fund_benchmark)',
    },
    benchmarkFundSize: {
      type: 'json',
      description: 'Fund size bucket the benchmark is built from (operations: fund_benchmark)',
    },
    benchmarkFundType: {
      type: 'json',
      description: 'Fund type the benchmark is built from (operations: fund_benchmark)',
    },
    benchmarkFundVintageYear: {
      type: 'number',
      description: 'Vintage year the benchmark is built from (operations: fund_benchmark)',
    },
    benchmarkFunds: {
      type: 'json',
      description: 'Funds making up the benchmark (operations: fund_benchmark)',
    },
    biography: {
      type: 'string',
      description: 'Biography of the person (operations: person_bio)',
    },
    boardSeats: {
      type: 'json',
      description: 'Board seats the person has held (operations: person_education_work)',
    },
    boardVotingRights: {
      type: 'string',
      description: 'Board voting rights terms (operations: deal_stock_info)',
    },
    businessStatus: {
      type: 'json',
      description: 'Operating status of the business (operations: company_bio)',
    },
    capTable: {
      type: 'json',
      description:
        'Stock series on the cap table as of the deal (operations: deal_cap_table_history)',
    },
    capTableAvailable: {
      type: 'boolean',
      description:
        'Whether cap table history exists for this deal (operations: deal_bio, deal_detailed)',
    },
    cikCode: {
      type: 'string',
      description: 'SEC CIK identifier (operations: company_bio)',
    },
    closeDate: {
      type: 'string',
      description: 'Date the fund closed (YYYY-MM-DD) (operations: fund_bio)',
    },
    commitments: {
      type: 'json',
      description:
        'Limited partner commitments to the fund (operations: fund_commitments, limited_partner_commitments_detailed)',
    },
    company: {
      type: 'json',
      description:
        'Company the record belongs to (operations: deal_debt_lenders, deal_tranche_info)',
    },
    companyId: {
      type: 'string',
      description:
        'PitchBook company ID (16 operations including company_bio, company_financials, company_general_service_providers)',
    },
    companyName: {
      type: 'json',
      description:
        'The names the company is known by (7 operations including company_bio, deal_bio, deal_detailed)',
    },
    companyRoles: {
      type: 'json',
      description: 'Positions the person has held at companies (operations: person_education_work)',
    },
    companySocialURLs: {
      type: 'json',
      description: 'Social profile links (operations: company_bio)',
    },
    contingentPayout: {
      type: 'json',
      description: 'Contingent payout attached to the deal (operations: deal_detailed)',
    },
    contracts: {
      type: 'json',
      description: 'Contracts on the account (operations: contracts_history)',
    },
    contributed: {
      type: 'json',
      description: 'Capital contributed by limited partners (operations: fund_cash_flows)',
    },
    conversionRatio: {
      type: 'string',
      description: 'Conversion ratio (operations: deal_stock_info)',
    },
    costs: {
      type: 'json',
      description: 'Credit cost per endpoint (operations: cost_of_calls)',
    },
    countActiveTeam: {
      type: 'number',
      description: 'Number of active team members (operations: fund_team)',
    },
    countAllInvestors: {
      type: 'number',
      description: 'Total number of investors on record (operations: company_investors)',
    },
    countInvestmentProfessionals: {
      type: 'number',
      description: 'Number of investment professionals on staff (operations: investor_bio)',
    },
    countOfClaims: {
      type: 'number',
      description: 'Number of claims (operations: patent_detailed)',
    },
    countOfIndependentClaims: {
      type: 'number',
      description: 'Number of independent claims (operations: patent_detailed)',
    },
    cpcClass: {
      type: 'json',
      description: 'CPC class (operations: patent_detailed)',
    },
    cpcSection: {
      type: 'json',
      description: 'CPC section (operations: patent_detailed)',
    },
    cpcSubclass: {
      type: 'json',
      description: 'CPC subclass (operations: patent_detailed)',
    },
    credits: {
      type: 'json',
      description: 'Credit usage per contract over the window (operations: credit_history)',
    },
    cumulativeness: {
      type: 'string',
      description: 'Whether dividends are cumulative (operations: deal_stock_info)',
    },
    current: {
      type: 'json',
      description: 'Current entries (operations: investor_board_seats)',
    },
    currentAdvisoryRoles: {
      type: 'json',
      description: 'Advisory roles the person currently holds (operations: person_education_work)',
    },
    currentAssigneeNames: {
      type: 'json',
      description: 'Current assignees (operations: patent_detailed)',
    },
    currentBoardMembersAndObservers: {
      type: 'json',
      description: 'Current board members and observers (operations: entity_people)',
    },
    currentGeneralServices: {
      type: 'json',
      description:
        'Current general service relationships (6 operations including company_general_service_providers, investor_general_service_providers, limited_partner_service_providers)',
    },
    currentTeam: {
      type: 'json',
      description: 'People currently working at the entity (operations: entity_people)',
    },
    dealAnnouncedDate: {
      type: 'string',
      description: 'Date the deal was announced (YYYY-MM-DD) (operations: deal_bio)',
    },
    dealClass: {
      type: 'json',
      description: 'Deal class, such as Venture Capital (operations: deal_bio, deal_detailed)',
    },
    dealDate: {
      type: 'string',
      description: 'Date the deal closed (YYYY-MM-DD) (operations: deal_bio, deal_detailed)',
    },
    dealId: {
      type: 'string',
      description:
        'PitchBook deal ID (8 operations including deal_bio, deal_debt_lenders, deal_detailed)',
    },
    dealNumber: {
      type: 'number',
      description:
        'Sequence of this deal in the company financing history (7 operations including deal_bio, deal_debt_lenders, deal_detailed)',
    },
    dealRoles: {
      type: 'json',
      description:
        'Deals the person worked on and who they represented (operations: person_education_work)',
    },
    dealServiceProviders: {
      type: 'json',
      description:
        'Service providers engaged on the company deals (operations: company_deal_service_providers, investor_deal_service_providers)',
    },
    dealSize: {
      type: 'json',
      description: 'Size of the deal (operations: deal_bio, deal_detailed)',
    },
    dealSizeStatus: {
      type: 'string',
      description:
        'Whether the deal size is actual or estimated (operations: deal_bio, deal_detailed)',
    },
    dealSizeToCashFlow: {
      type: 'number',
      description: 'Deal size to cash flow (operations: deal_multiples)',
    },
    dealSizeToEBIT: {
      type: 'number',
      description: 'Deal size to EBIT (operations: deal_multiples)',
    },
    dealSizeToEBITDA: {
      type: 'number',
      description: 'Deal size to EBITDA (operations: deal_multiples)',
    },
    dealSizeToNetIncome: {
      type: 'json',
      description: 'Deal size to net income (operations: deal_multiples)',
    },
    dealSizeToRevenue: {
      type: 'number',
      description: 'Deal size to revenue (operations: deal_multiples)',
    },
    dealStatus: {
      type: 'json',
      description: 'Status of the deal, such as Completed (operations: deal_bio, deal_detailed)',
    },
    dealSynopsis: {
      type: 'string',
      description: 'Narrative summary of the deal (operations: deal_detailed)',
    },
    dealType1: {
      type: 'json',
      description: 'Primary deal type (operations: deal_bio, deal_detailed)',
    },
    dealType2: {
      type: 'json',
      description:
        'Secondary deal type, such as the round letter (operations: deal_bio, deal_detailed)',
    },
    dealType3: {
      type: 'json',
      description: 'Tertiary deal type (operations: deal_bio, deal_detailed)',
    },
    deals: {
      type: 'json',
      description: 'Deals involving the company, oldest first (operations: company_deals)',
    },
    debtAmount1: {
      type: 'json',
      description: 'Amount of the primary debt type (operations: deal_detailed)',
    },
    debtAmount2: {
      type: 'json',
      description: 'Amount of the secondary debt type (operations: deal_detailed)',
    },
    debtAmount3: {
      type: 'json',
      description: 'Amount of the tertiary debt type (operations: deal_detailed)',
    },
    debtLenderInfoAvailable: {
      type: 'boolean',
      description:
        'Whether debt and lender information exists for this deal (operations: deal_bio, deal_detailed)',
    },
    debtRaisedInRound: {
      type: 'json',
      description: 'Total debt raised in the round (operations: deal_detailed)',
    },
    debtRaisedInRoundToEBITDA: {
      type: 'json',
      description: 'Debt raised in round to EBITDA (operations: deal_multiples)',
    },
    debtRaisedInRoundToEquity: {
      type: 'json',
      description: 'Debt raised in round to equity (operations: deal_multiples)',
    },
    debtType1: {
      type: 'json',
      description: 'Primary debt type raised in the deal (operations: deal_detailed)',
    },
    debtType2: {
      type: 'json',
      description: 'Secondary debt type raised in the deal (operations: deal_detailed)',
    },
    debtType3: {
      type: 'json',
      description: 'Tertiary debt type raised in the deal (operations: deal_detailed)',
    },
    debts: {
      type: 'json',
      description: 'Debt instruments in the deal (operations: deal_debt_lenders)',
    },
    description: {
      type: 'json',
      description:
        'Business description (4 operations including company_bio, investor_bio, limited_partner_bio)',
    },
    distributed: {
      type: 'json',
      description: 'Capital distributed back to limited partners (operations: fund_cash_flows)',
    },
    distributedRemaining: {
      type: 'json',
      description: 'Distributed plus remaining value (operations: fund_cash_flows)',
    },
    dividendRights: {
      type: 'string',
      description: 'Dividend rights terms (operations: deal_stock_info)',
    },
    documentBackwardCitations: {
      type: 'number',
      description: 'Number of backward citations (operations: patent_detailed)',
    },
    documentForwardCitations: {
      type: 'number',
      description: 'Number of forward citations (operations: patent_detailed)',
    },
    dpi: {
      type: 'number',
      description: 'Distributions to paid-in multiple (operations: fund_performance)',
    },
    dpiBenchmark: {
      type: 'number',
      description: 'Benchmark DPI (operations: fund_benchmark)',
    },
    dryPowder: {
      type: 'json',
      description:
        'Uncalled capital available to deploy (operations: fund_cash_flows, investor_bio)',
    },
    duplicates: {
      type: 'json',
      description: 'Article IDs that were requested more than once (operations: credit_news_bulk)',
    },
    ebitda: {
      type: 'json',
      description: 'EBITDA (operations: company_most_recent_financials)',
    },
    education: {
      type: 'json',
      description: 'Institutions the person attended (operations: person_education_work)',
    },
    email: {
      type: 'string',
      description: 'Email address (operations: person_contact)',
    },
    emergingSpaces: {
      type: 'json',
      description:
        'Analyst-defined emerging spaces the company is placed in (operations: company_industries)',
    },
    employeeHistory: {
      type: 'json',
      description: 'Reported headcount over time (operations: company_bio)',
    },
    employees: {
      type: 'number',
      description: 'Current employee count (operations: company_bio, service_provider_bio)',
    },
    endDate: {
      type: 'string',
      description: 'Period end date (YYYY-MM-DD) (operations: company_most_recent_financials)',
    },
    enterpriseValue: {
      type: 'json',
      description: 'Enterprise value (operations: company_most_recent_financials)',
    },
    entities: {
      type: 'json',
      description:
        'Entities the sandbox key may query. PitchBook names this array after the requested entity type, so it is surfaced under a stable `entities` key rather than the type-specific one (operations: sandbox_entities)',
    },
    entityId: {
      type: 'string',
      description: 'PitchBook entity ID (operations: entity_locations, entity_people)',
    },
    entityTypeCounts: {
      type: 'json',
      description:
        'Count of available sandbox entities, keyed by entity type (operations: sandbox_entities)',
    },
    exchange: {
      type: 'string',
      description: 'Stock exchange the company trades on (operations: company_bio)',
    },
    exitClass: {
      type: 'string',
      description:
        'Most likely exit type, such as IPO or M&A (operations: company_vc_exit_predictions)',
    },
    exiters: {
      type: 'json',
      description: 'Investors exiting through the deal (operations: deal_investors)',
    },
    expirationDate: {
      type: 'json',
      description: 'Expiration date (YYYY-MM-DD) (operations: patent_detailed)',
    },
    familyId: {
      type: 'string',
      description: 'Patent family ID (operations: patent_detailed)',
    },
    fax: {
      type: 'string',
      description: 'Fax number (operations: person_contact)',
    },
    filingAuthorityLocation: {
      type: 'string',
      description: 'Filing authority location (operations: patent_detailed)',
    },
    financingStatus: {
      type: 'json',
      description: 'How the company is financed (operations: company_bio)',
    },
    financingStatusNote: {
      type: 'json',
      description: 'Analyst note explaining the financing status (operations: company_bio)',
    },
    firstFilingDate: {
      type: 'string',
      description: 'First filing date (YYYY-MM-DD) (operations: patent_detailed)',
    },
    former: {
      type: 'json',
      description: 'Former team members (operations: fund_team, investor_board_seats)',
    },
    formerBoardMembersAndObservers: {
      type: 'json',
      description: 'Former board members and observers (operations: entity_people)',
    },
    formerGeneralServices: {
      type: 'json',
      description:
        'Former general service relationships (6 operations including company_general_service_providers, investor_general_service_providers, limited_partner_service_providers)',
    },
    formerTeam: {
      type: 'json',
      description: 'People who previously worked at the entity (operations: entity_people)',
    },
    found: {
      type: 'json',
      description: 'Articles that were found (operations: credit_news_bulk)',
    },
    fullName: {
      type: 'string',
      description: 'Full name of the person (operations: person_contact, person_education_work)',
    },
    fundCloseDate: {
      type: 'string',
      description: 'Date the fund closed (YYYY-MM-DD) (operations: investor_last_closed_fund)',
    },
    fundId: {
      type: 'string',
      description:
        'PitchBook fund ID (8 operations including fund_benchmark, fund_bio, fund_cash_flows)',
    },
    fundInfo: {
      type: 'json',
      description: 'Funds the investor manages (operations: investor_funds)',
    },
    fundInvestors: {
      type: 'json',
      description:
        'Managers of the fund, with where it sits in their fund series (operations: fund_bio)',
    },
    fundName: {
      type: 'string',
      description:
        'Fund name (5 operations including fund_benchmark, fund_cash_flows, fund_investments)',
    },
    fundOpenDate: {
      type: 'json',
      description: 'Date the fund opened (YYYY-MM-DD) (operations: investor_last_closed_fund)',
    },
    fundRoles: {
      type: 'json',
      description: 'Funds the person is associated with (operations: person_education_work)',
    },
    fundServices: {
      type: 'json',
      description: 'Funds the service provider worked with (operations: serviced_funds)',
    },
    fundSize: {
      type: 'json',
      description: 'Capital raised by the fund (operations: fund_bio, investor_last_closed_fund)',
    },
    fundStatus: {
      type: 'string',
      description: 'Whether the fund is open or closed (operations: fund_bio)',
    },
    fundTargetSize: {
      type: 'json',
      description:
        'Target raise for the fund, as a min and max monetary value (operations: fund_bio)',
    },
    fundTeam: {
      type: 'json',
      description: 'People on the fund team (operations: fund_bio)',
    },
    fundType: {
      type: 'json',
      description: 'Type of the fund (operations: fund_bio, investor_last_closed_fund)',
    },
    fundVintage: {
      type: 'number',
      description: 'Vintage year of the fund (operations: investor_last_closed_fund)',
    },
    gender: {
      type: 'string',
      description: 'Gender recorded for the person (operations: person_bio)',
    },
    generalVotingRights: {
      type: 'string',
      description: 'General voting rights terms (operations: deal_stock_info)',
    },
    geographicalPreferences: {
      type: 'json',
      description:
        'Regions targeted (operations: fund_investment_preferences, investor_preferences)',
    },
    grantDate: {
      type: 'string',
      description: 'Grant date (YYYY-MM-DD) (operations: patent_detailed)',
    },
    growthRate: {
      type: 'number',
      description: 'Overall growth rate (operations: company_social_analytics)',
    },
    growthRateChange: {
      type: 'number',
      description: 'Change in the overall growth rate (operations: company_social_analytics)',
    },
    growthRatePercentChange: {
      type: 'number',
      description:
        'Percent change in the overall growth rate (operations: company_social_analytics)',
    },
    growthRatePercentile: {
      type: 'number',
      description: 'Percentile of the overall growth rate (operations: company_social_analytics)',
    },
    hqLocation: {
      type: 'json',
      description: 'Headquarters location (operations: company_bio, investor_bio)',
    },
    hqOffice: {
      type: 'json',
      description: 'Headquarters office (operations: entity_locations)',
    },
    impliedEvToCashFlow: {
      type: 'number',
      description: 'Implied EV to cash flow (operations: deal_multiples)',
    },
    impliedEvToEBIT: {
      type: 'number',
      description: 'Implied EV to EBIT (operations: deal_multiples)',
    },
    impliedEvToEBITDA: {
      type: 'number',
      description: 'Implied EV to EBITDA (operations: deal_multiples)',
    },
    impliedEvToNetIncome: {
      type: 'json',
      description: 'Implied EV to net income (operations: deal_multiples)',
    },
    impliedEvToRevenue: {
      type: 'number',
      description: 'Implied EV to revenue (operations: deal_multiples)',
    },
    industries: {
      type: 'json',
      description:
        'Industry classifications, most specific first. One entry is flagged primary (operations: company_industries)',
    },
    inventors: {
      type: 'json',
      description: 'Named inventors (operations: patent_detailed)',
    },
    investments: {
      type: 'json',
      description: 'Investments held (operations: fund_investments, investor_investments)',
    },
    investorId: {
      type: 'string',
      description:
        'PitchBook investor ID (6 operations including investor_bio, investor_board_seats, investor_funds)',
    },
    investorIds: {
      type: 'json',
      description: 'PitchBook IDs of the fund managers (operations: fund_team)',
    },
    investorName: {
      type: 'json',
      description:
        'The names the investor is known by (operations: investor_bio, investor_preferences)',
    },
    investorOwnership: {
      type: 'number',
      description:
        'Percentage of the company owned by investors after the deal (operations: deal_detailed)',
    },
    investorStatus: {
      type: 'json',
      description: 'Whether the investor is actively investing (operations: investor_bio)',
    },
    investorType: {
      type: 'json',
      description:
        'Types the investor is classified as, one flagged primary (operations: investor_bio)',
    },
    investors: {
      type: 'json',
      description:
        'Investors in the company, current and former (operations: company_investors, deal_investors)',
    },
    ipoProbability: {
      type: 'number',
      description:
        'Probability of an IPO exit, as a percentage (operations: company_vc_exit_predictions)',
    },
    irr: {
      type: 'number',
      description: 'Internal rate of return, as a percentage (operations: fund_performance)',
    },
    irrBenchmark: {
      type: 'number',
      description: 'Benchmark IRR (operations: fund_benchmark)',
    },
    issuer: {
      type: 'json',
      description: 'Issuer the article is about (operations: credit_news)',
    },
    items: {
      type: 'json',
      description:
        'Records returned (14 operations including company_financials, company_search, credit_news_most_recent)',
    },
    keywords: {
      type: 'json',
      description: 'Keywords associated with the company (operations: company_industries)',
    },
    lastDebtFinancing: {
      type: 'json',
      description:
        'Debt instruments in the most recent debt financing (operations: company_most_recent_debt_financing)',
    },
    lastDebtFinancingDate: {
      type: 'string',
      description:
        'Date of the most recent debt financing (YYYY-MM-DD) (operations: company_most_recent_debt_financing)',
    },
    lastDebtFinancingDealId: {
      type: 'string',
      description:
        'PitchBook deal ID of the most recent debt financing (operations: company_most_recent_debt_financing)',
    },
    lastFinancingDate: {
      type: 'string',
      description:
        'Date of the most recent financing (YYYY-MM-DD) (operations: company_most_recent_financing)',
    },
    lastFinancingDealClass: {
      type: 'json',
      description:
        'Deal class of the most recent financing (operations: company_most_recent_financing)',
    },
    lastFinancingDealId: {
      type: 'string',
      description:
        'PitchBook deal ID of the most recent financing (operations: company_most_recent_financing)',
    },
    lastFinancingDealType: {
      type: 'json',
      description:
        'Primary deal type of the most recent financing (operations: company_most_recent_financing)',
    },
    lastFinancingDealType2: {
      type: 'json',
      description:
        'Secondary deal type of the most recent financing (operations: company_most_recent_financing)',
    },
    lastFinancingDealType3: {
      type: 'json',
      description:
        'Tertiary deal type of the most recent financing (operations: company_most_recent_financing)',
    },
    lastFinancingSize: {
      type: 'json',
      description: 'Size of the most recent financing (operations: company_most_recent_financing)',
    },
    lastFinancingSizeStatus: {
      type: 'string',
      description:
        'Whether the financing size is actual or estimated (operations: company_most_recent_financing)',
    },
    lastFinancingValuation: {
      type: 'json',
      description:
        'Valuation at the most recent financing (operations: company_most_recent_financing)',
    },
    lastFinancingValuationStatus: {
      type: 'string',
      description:
        'Whether the valuation is actual or estimated (operations: company_most_recent_financing)',
    },
    lastKnownValuation: {
      type: 'json',
      description:
        'Most recent known valuation of the company (operations: company_most_recent_financing)',
    },
    lastKnownValuationDate: {
      type: 'string',
      description:
        'Date of the last known valuation (YYYY-MM-DD) (operations: company_most_recent_financing)',
    },
    lastKnownValuationDealType: {
      type: 'json',
      description:
        'Deal type the last known valuation came from (operations: company_most_recent_financing)',
    },
    lender: {
      type: 'json',
      description: 'Lender the article is about (operations: credit_news)',
    },
    limitedPartnerId: {
      type: 'string',
      description:
        'PitchBook limited partner ID (6 operations including limited_partner_actual_allocations, limited_partner_bio, limited_partner_commitment_aggregates)',
    },
    limitedPartnerName: {
      type: 'json',
      description:
        'Limited partner name (5 operations including limited_partner_actual_allocations, limited_partner_bio, limited_partner_commitment_aggregates)',
    },
    limitedPartnerTypes: {
      type: 'json',
      description:
        'Types the limited partner is classified as, one flagged primary (operations: limited_partner_bio)',
    },
    linkedInProfileUrl: {
      type: 'string',
      description: 'LinkedIn profile URL (operations: person_bio)',
    },
    liquidationParticipating: {
      type: 'string',
      description: 'Whether the preference participates (operations: deal_stock_info)',
    },
    liquidationPreferences: {
      type: 'string',
      description: 'Liquidation preference terms (operations: deal_stock_info)',
    },
    location: {
      type: 'json',
      description: 'Office the fund is run from (operations: fund_bio)',
    },
    managementStaff: {
      type: 'number',
      description: 'Number of management staff (operations: limited_partner_bio)',
    },
    maxFundSize: {
      type: 'json',
      description: 'Largest fund raised (operations: investor_funds)',
    },
    medianFundSize: {
      type: 'json',
      description: 'Median fund size (operations: investor_funds)',
    },
    mergeracquisitionProbability: {
      type: 'number',
      description:
        'Probability of an M&A exit, as a percentage (operations: company_vc_exit_predictions)',
    },
    minFundSize: {
      type: 'json',
      description: 'Smallest fund raised (operations: investor_funds)',
    },
    morningstarCode: {
      type: 'string',
      description: 'Morningstar identifier (operations: company_bio)',
    },
    mostRecentLegalStatus: {
      type: 'string',
      description: 'Most recent legal status (operations: patent_detailed)',
    },
    mostRecentLegalStatusDate: {
      type: 'string',
      description:
        'Date of the most recent legal status (YYYY-MM-DD) (operations: patent_detailed)',
    },
    name: {
      type: 'string',
      description: 'Fund name (operations: fund_bio)',
    },
    nav: {
      type: 'number',
      description: 'Net asset value (operations: fund_performance)',
    },
    netIncome: {
      type: 'json',
      description: 'Net income (operations: company_most_recent_financials)',
    },
    news: {
      type: 'json',
      description:
        'News articles associated with the entity, most recent first (operations: entity_news)',
    },
    noexitProbability: {
      type: 'number',
      description:
        'Probability of no exit, as a percentage (operations: company_vc_exit_predictions)',
    },
    notFound: {
      type: 'json',
      description: 'Article IDs that were not found (operations: credit_news_bulk)',
    },
    numberOfFundsInBenchmark: {
      type: 'number',
      description:
        'How many funds the benchmark is drawn from (operations: fund_benchmark, fund_performance)',
    },
    numberOfSharesAcquired: {
      type: 'number',
      description: 'Shares acquired (operations: deal_stock_info)',
    },
    openDate: {
      type: 'string',
      description: 'Date the fund opened (YYYY-MM-DD) (operations: fund_bio)',
    },
    opportunityScore: {
      type: 'number',
      description: 'PitchBook opportunity score (operations: company_vc_exit_predictions)',
    },
    originalAssigneeNames: {
      type: 'json',
      description: 'Original assignees (operations: patent_detailed)',
    },
    otherInvestmentPreferences: {
      type: 'json',
      description:
        'Other stated preferences (operations: fund_investment_preferences, investor_preferences, limited_partner_commitment_preferences)',
    },
    ownershipStatus: {
      type: 'json',
      description: 'Ownership status of the company (operations: company_bio)',
    },
    parentCompanyId: {
      type: 'string',
      description: 'PitchBook ID of the parent company (operations: company_bio)',
    },
    parentCompanyName: {
      type: 'string',
      description: 'Name of the parent company (operations: company_bio)',
    },
    patentDownloadUrl: {
      type: 'string',
      description: 'Link to download the patent document (operations: patent_detailed)',
    },
    patentId: {
      type: 'string',
      description: 'Patent ID (operations: patent_detailed)',
    },
    patentTitle: {
      type: 'string',
      description: 'Patent title (operations: patent_detailed)',
    },
    percentAcquired: {
      type: 'number',
      description: 'Percentage of the company acquired in the deal (operations: deal_detailed)',
    },
    percentCalledDown: {
      type: 'number',
      description: 'Percentage of committed capital called down (operations: fund_cash_flows)',
    },
    percentDryPowder: {
      type: 'number',
      description: 'Percentage of committed capital still uncalled (operations: fund_cash_flows)',
    },
    period: {
      type: 'number',
      description: 'Fiscal period the figures cover (operations: company_most_recent_financials)',
    },
    personId: {
      type: 'string',
      description:
        'PitchBook person ID (operations: person_bio, person_contact, person_education_work)',
    },
    personName: {
      type: 'json',
      description: 'Parsed name of the person (operations: person_bio)',
    },
    phone: {
      type: 'string',
      description: 'Phone number (operations: person_contact)',
    },
    pitchBookProfileLink: {
      type: 'string',
      description:
        'Link to the company profile in the PitchBook platform (operations: company_bio)',
    },
    postValuation: {
      type: 'json',
      description: 'Post-money valuation (operations: deal_valuation)',
    },
    postValuationStatus: {
      type: 'string',
      description:
        'Whether the post-money valuation is actual or estimated (operations: deal_valuation)',
    },
    preValuation: {
      type: 'json',
      description: 'Pre-money valuation (operations: deal_valuation)',
    },
    predictionDate: {
      type: 'string',
      description:
        'Date the prediction was generated (YYYY-MM-DD) (operations: company_vc_exit_predictions)',
    },
    preferredCommitmentSize: {
      type: 'json',
      description: 'Preferred commitment size (operations: limited_partner_commitment_preferences)',
    },
    preferredCompanyValuation: {
      type: 'json',
      description:
        'Preferred company valuation (operations: fund_investment_preferences, investor_preferences)',
    },
    preferredDealSize: {
      type: 'json',
      description:
        'Preferred deal size (operations: fund_investment_preferences, investor_preferences)',
    },
    preferredDealTypes: {
      type: 'json',
      description:
        'Deal types targeted (operations: fund_investment_preferences, investor_preferences)',
    },
    preferredDirectInvestmentSize: {
      type: 'json',
      description:
        'Preferred direct investment size (operations: limited_partner_commitment_preferences)',
    },
    preferredEbit: {
      type: 'json',
      description: 'Preferred EBIT (operations: fund_investment_preferences, investor_preferences)',
    },
    preferredEbitda: {
      type: 'json',
      description:
        'Preferred EBITDA (operations: fund_investment_preferences, investor_preferences)',
    },
    preferredFundTypes: {
      type: 'json',
      description:
        'Fund types the limited partner targets (operations: limited_partner_commitment_preferences)',
    },
    preferredGeography: {
      type: 'json',
      description:
        'Regions the limited partner targets (operations: limited_partner_commitment_preferences)',
    },
    preferredIndustry: {
      type: 'json',
      description:
        'Industries targeted (operations: fund_investment_preferences, investor_preferences)',
    },
    preferredInvestmentAmount: {
      type: 'json',
      description:
        'Preferred check size (operations: fund_investment_preferences, investor_preferences)',
    },
    preferredInvestmentHorizon: {
      type: 'json',
      description:
        'Preferred holding period in years (operations: fund_investment_preferences, investor_preferences)',
    },
    preferredRevenue: {
      type: 'json',
      description:
        'Preferred revenue (operations: fund_investment_preferences, investor_preferences)',
    },
    preferredVerticals: {
      type: 'json',
      description:
        'Verticals targeted (operations: fund_investment_preferences, investor_preferences)',
    },
    pricePerShare: {
      type: 'json',
      description: 'Price per share (operations: deal_stock_info)',
    },
    primaryContact: {
      type: 'json',
      description: 'Primary contact at the entity (operations: entity_people)',
    },
    primaryEntityId: {
      type: 'string',
      description: 'PitchBook ID of the primary employer (operations: person_bio)',
    },
    primaryEntityName: {
      type: 'string',
      description: 'Name of the primary employer (operations: person_bio)',
    },
    primaryEntityType: {
      type: 'string',
      description:
        'Type of the primary employer, such as COMPANY or INVESTOR (operations: person_bio)',
    },
    primaryEntityWebsite: {
      type: 'string',
      description: 'Website of the primary employer (operations: person_bio)',
    },
    primaryOffice: {
      type: 'json',
      description: 'Office the person works out of (operations: person_bio)',
    },
    primaryPosition: {
      type: 'string',
      description: 'Position the person holds at the primary employer (operations: person_bio)',
    },
    publicationDate: {
      type: 'string',
      description: 'Publication date (YYYY-MM-DD) (operations: patent_detailed)',
    },
    publishDate: {
      type: 'string',
      description: 'Publication timestamp (ISO 8601) (operations: credit_news)',
    },
    quartile: {
      type: 'number',
      description:
        'Benchmark quartile the fund falls in, 1 being the best (operations: fund_performance)',
    },
    raisedToDate: {
      type: 'json',
      description: 'Total the company had raised as of this deal (operations: deal_detailed)',
    },
    rawData: {
      type: 'json',
      description: 'Individual call records (operations: usage_report)',
    },
    redemptionRights: {
      type: 'json',
      description: 'Redemption rights terms (operations: deal_stock_info)',
    },
    regions: {
      type: 'json',
      description: 'Geographic regions the article covers (operations: credit_news)',
    },
    remainingValue: {
      type: 'json',
      description: 'Remaining value held in the fund (operations: fund_cash_flows)',
    },
    returnsInfoAvailable: {
      type: 'json',
      description: 'Which returns datasets are available for the fund (operations: fund_bio)',
    },
    revenue: {
      type: 'json',
      description: 'Revenue (operations: company_most_recent_financials)',
    },
    rvpi: {
      type: 'number',
      description: 'Residual value to paid-in multiple (operations: fund_performance)',
    },
    rvpiBenchmark: {
      type: 'number',
      description: 'Benchmark RVPI (operations: fund_benchmark)',
    },
    sbic: {
      type: 'boolean',
      description: 'Whether the fund is a Small Business Investment Company (operations: fund_bio)',
    },
    searchCriteria: {
      type: 'string',
      description: 'Criteria of the shared search (operations: shared_search)',
    },
    sellers: {
      type: 'json',
      description: 'Parties selling in the deal (operations: deal_investors)',
    },
    series: {
      type: 'string',
      description: 'Stock series (operations: deal_stock_info)',
    },
    serviceProviderId: {
      type: 'string',
      description:
        'PitchBook service provider ID (5 operations including service_provider_bio, serviced_companies, serviced_funds)',
    },
    serviceProviderName: {
      type: 'json',
      description:
        'The names the service provider is known by (6 operations including service_provider_bio, serviced_companies, serviced_deals)',
    },
    serviceProviderTypes: {
      type: 'json',
      description:
        'Types the service provider is classified as, one flagged primary (operations: service_provider_bio)',
    },
    serviceProviders: {
      type: 'json',
      description: 'Service providers that worked on the deal (operations: deal_service_providers)',
    },
    servicedCompanies: {
      type: 'number',
      description: 'Number of companies serviced (operations: service_provider_bio)',
    },
    servicedDealInfo: {
      type: 'json',
      description: 'Deals the service provider worked on (operations: serviced_deals)',
    },
    servicedDeals: {
      type: 'number',
      description: 'Number of deals serviced (operations: service_provider_bio)',
    },
    servicedFunds: {
      type: 'number',
      description: 'Number of funds serviced (operations: service_provider_bio)',
    },
    servicedInvestors: {
      type: 'number',
      description: 'Number of investors serviced (operations: service_provider_bio)',
    },
    servicedLimitedPartners: {
      type: 'number',
      description: 'Number of limited partners serviced (operations: service_provider_bio)',
    },
    sharesSought: {
      type: 'number',
      description: 'Shares sought (operations: deal_stock_info)',
    },
    sicCodes: {
      type: 'json',
      description: 'SIC classification codes (operations: company_bio)',
    },
    similarCompanies: {
      type: 'json',
      description: 'Similar companies, most similar first (operations: company_similar_companies)',
    },
    sizeMultiple: {
      type: 'number',
      description: 'Overall size multiple (operations: company_social_analytics)',
    },
    sizeMultipleChange: {
      type: 'number',
      description: 'Change in the size multiple (operations: company_social_analytics)',
    },
    sizeMultiplePercentChange: {
      type: 'number',
      description: 'Percent change in the size multiple (operations: company_social_analytics)',
    },
    sizeMultiplePercentile: {
      type: 'number',
      description: 'Percentile of the size multiple (operations: company_social_analytics)',
    },
    socialGrowthRate: {
      type: 'number',
      description: 'Social following growth rate (operations: company_social_analytics)',
    },
    socialGrowthRatePercentile: {
      type: 'number',
      description: 'Percentile of the social growth rate (operations: company_social_analytics)',
    },
    socialSizeMultiple: {
      type: 'number',
      description: 'Social size multiple (operations: company_social_analytics)',
    },
    socialSizeMultiplePercentile: {
      type: 'number',
      description: 'Percentile of the social size multiple (operations: company_social_analytics)',
    },
    sponsor: {
      type: 'json',
      description: 'Sponsor the article is about (operations: credit_news)',
    },
    stats: {
      type: 'json',
      description:
        'Paging envelope for the result set (15 operations including company_search, credit_news_bulk, credit_news_most_recent)',
    },
    status: {
      type: 'string',
      description: 'Status (operations: patent_detailed)',
    },
    stockSplit: {
      type: 'string',
      description: 'Stock split applied at the deal, such as 1:1 (operations: deal_detailed)',
    },
    stockType: {
      type: 'json',
      description: 'Type of stock (operations: deal_stock_info)',
    },
    successClass: {
      type: 'string',
      description:
        'Predicted outcome class, such as Success (operations: company_vc_exit_predictions)',
    },
    successProbability: {
      type: 'number',
      description:
        'Probability of a successful outcome, as a percentage (operations: company_vc_exit_predictions)',
    },
    tables: {
      type: 'json',
      description: 'Lookup tables available (operations: lookup_table_structure)',
    },
    targetAllocations: {
      type: 'json',
      description: 'Target asset allocations (operations: limited_partner_target_allocations)',
    },
    ticker: {
      type: 'string',
      description: 'Stock ticker (operations: company_bio)',
    },
    title: {
      type: 'string',
      description: 'Title (operations: credit_news)',
    },
    topics: {
      type: 'json',
      description: 'Topics the article covers (operations: credit_news)',
    },
    totalActiveCommitments: {
      type: 'number',
      description:
        'Number of active commitments (operations: limited_partner_commitment_aggregates)',
    },
    totalAssets: {
      type: 'json',
      description: 'Total assets (operations: company_most_recent_financials)',
    },
    totalCommitments: {
      type: 'number',
      description:
        'Number of commitments ever made (operations: limited_partner_commitment_aggregates)',
    },
    totalCommitmentsInDebtFunds: {
      type: 'json',
      description:
        'Number of all commitments to debt funds (operations: limited_partner_commitment_aggregates)',
    },
    totalCommitmentsInEnergyFunds: {
      type: 'json',
      description:
        'Number of all commitments to energy funds (operations: limited_partner_commitment_aggregates)',
    },
    totalCommitmentsInFoFsAnd2nd: {
      type: 'json',
      description:
        'Number of all commitments to funds of funds and secondaries (operations: limited_partner_commitment_aggregates)',
    },
    totalCommitmentsInInfrastructure: {
      type: 'json',
      description:
        'Number of all commitments to infrastructure funds (operations: limited_partner_commitment_aggregates)',
    },
    totalCommitmentsInOtherFunds: {
      type: 'number',
      description:
        'Number of all commitments to other funds (operations: limited_partner_commitment_aggregates)',
    },
    totalCommitmentsInPeFunds: {
      type: 'number',
      description:
        'Number of all commitments to PE funds (operations: limited_partner_commitment_aggregates)',
    },
    totalCommitmentsInReFunds: {
      type: 'number',
      description:
        'Number of all commitments to real estate funds (operations: limited_partner_commitment_aggregates)',
    },
    totalCommitmentsInVcFunds: {
      type: 'number',
      description:
        'Number of all commitments to VC funds (operations: limited_partner_commitment_aggregates)',
    },
    totalDebt: {
      type: 'json',
      description: 'Total debt (operations: company_most_recent_financials)',
    },
    totalInvestedCapital: {
      type: 'json',
      description: 'Total capital invested in the deal (operations: deal_detailed)',
    },
    totalInvestedEquity: {
      type: 'json',
      description: 'Total equity invested in the deal (operations: deal_detailed)',
    },
    totalMoneyRaised: {
      type: 'json',
      description: 'Total capital raised to date (operations: company_bio)',
    },
    tradeAssociations: {
      type: 'json',
      description: 'Trade associations the investor belongs to (operations: investor_bio)',
    },
    trancheInfoAvailable: {
      type: 'boolean',
      description:
        'Whether tranche information exists for this deal (operations: deal_bio, deal_detailed)',
    },
    tranches: {
      type: 'json',
      description: 'Tranches making up the deal (operations: deal_tranche_info)',
    },
    tvpi: {
      type: 'number',
      description: 'Total value to paid-in multiple (operations: fund_performance)',
    },
    tvpiBenchmark: {
      type: 'number',
      description: 'Benchmark TVPI (operations: fund_benchmark)',
    },
    twitterFollowers: {
      type: 'number',
      description: 'Twitter/X follower count (operations: company_social_analytics)',
    },
    twitterFollowersChange: {
      type: 'number',
      description: 'Change in follower count (operations: company_social_analytics)',
    },
    twitterFollowersPercentChange: {
      type: 'number',
      description: 'Percent change in follower count (operations: company_social_analytics)',
    },
    universe: {
      type: 'json',
      description: 'PitchBook universes the company belongs to (operations: company_bio)',
    },
    updates: {
      type: 'json',
      description:
        'Map of dataset name to whether it changed in the window. Keys are PitchBook dataset names, so read it as a plain object (7 operations including company_updates, deal_updates, entity_updates)',
    },
    valuationAvailable: {
      type: 'boolean',
      description:
        'Whether valuation data exists for this deal (operations: deal_bio, deal_detailed)',
    },
    valuationToCashFlow: {
      type: 'number',
      description: 'Valuation to cash flow (operations: deal_multiples)',
    },
    valuationToEBIT: {
      type: 'number',
      description: 'Valuation to EBIT (operations: deal_multiples)',
    },
    valuationToEBITDA: {
      type: 'number',
      description: 'Valuation to EBITDA (operations: deal_multiples)',
    },
    valuationToNetIncome: {
      type: 'json',
      description: 'Valuation to net income (operations: deal_multiples)',
    },
    valuationToRevenue: {
      type: 'number',
      description: 'Valuation to revenue (operations: deal_multiples)',
    },
    vcDealNumber: {
      type: 'number',
      description:
        'Number of VC deals the prediction is based on (operations: company_vc_exit_predictions)',
    },
    vcRound: {
      type: 'string',
      description: 'Venture round label, such as 1st Round (operations: deal_detailed)',
    },
    vcRoundUpDownFlat: {
      type: 'string',
      description:
        'Whether the round was up, down, or flat versus the previous one (operations: deal_detailed)',
    },
    verticals: {
      type: 'json',
      description: 'Verticals the company operates in (operations: company_industries)',
    },
    vintage: {
      type: 'number',
      description: 'Vintage year of the fund (operations: fund_bio)',
    },
    webGrowthRate: {
      type: 'number',
      description: 'Web traffic growth rate (operations: company_social_analytics)',
    },
    webGrowthRatePercentile: {
      type: 'number',
      description: 'Percentile of the web growth rate (operations: company_social_analytics)',
    },
    webSizeMultiple: {
      type: 'number',
      description: 'Web size multiple (operations: company_social_analytics)',
    },
    webSizeMultiplePercentile: {
      type: 'number',
      description: 'Percentile of the web size multiple (operations: company_social_analytics)',
    },
    website: {
      type: 'string',
      description:
        'Company website (4 operations including company_bio, investor_bio, limited_partner_bio)',
    },
    yearFounded: {
      type: 'number',
      description:
        'Year the company was founded (operations: company_bio, investor_bio, limited_partner_bio)',
    },
  },
}

export const PitchBookBlockMeta = {
  tags: ['enrichment', 'data-analytics'],
  url: 'https://pitchbook.com',
  templates: [
    {
      icon: PitchBookIcon,
      title: 'PitchBook deal flow monitor',
      prompt:
        'Build a scheduled workflow that runs a PitchBook company search for early-stage VC deals in my target verticals closed in the last week, pulls each deal size and lead investor, writes them to a deal-flow table, and posts a digest to the investment team Slack channel.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'reporting', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PitchBookIcon,
      title: 'PitchBook company diligence brief',
      prompt:
        'Create an agent that takes a company name, resolves it to a PitchBook ID, pulls the bio, industries, investors, full deal history, and latest financials, then writes a diligence brief covering funding trajectory, cap table participants, and comparable companies.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['research', 'reporting'],
    },
    {
      icon: Building,
      title: 'PitchBook investor targeting',
      prompt:
        'Build a workflow that takes my company profile and stage, searches PitchBook for investors whose stated preferences match on deal type, check size, industry, and geography, enriches each with their recent investments, and ranks the resulting target list in a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['research', 'crm'],
    },
    {
      icon: PitchBookIcon,
      title: 'PitchBook fund performance tracker',
      prompt:
        'Create a scheduled workflow that pulls the latest IRR, TVPI, DPI, and benchmark quartile for each fund on my watchlist from PitchBook, appends the quarterly snapshot to a performance table, and flags any fund that has dropped a quartile.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'monitoring'],
    },
    {
      icon: PitchBookIcon,
      title: 'PitchBook competitor watch',
      prompt:
        'Build a scheduled workflow that fetches PitchBook similar companies for my main product, checks each one for new financing rounds and recent news, summarizes what changed with an agent, and emails the competitive brief to the product team every Monday.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['research', 'monitoring', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: Building,
      title: 'PitchBook LP commitment mapper',
      prompt:
        'Create a workflow that searches PitchBook limited partners matching a target profile, pulls their commitment history and preferences, and builds a table mapping which LPs back which fund types so the fundraising team knows who to approach.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['research', 'crm'],
    },
    {
      icon: PitchBookIcon,
      title: 'PitchBook buying committee lookup',
      prompt:
        'Build a workflow that takes a target account, resolves it in PitchBook, pulls the current team and board members with their titles, filters to the decision-makers for my product, and syncs the mapped contacts into HubSpot.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['research', 'crm', 'automation'],
      alsoIntegrations: ['hubspot'],
    },
  ],
  skills: [
    {
      name: 'company-diligence-brief',
      description:
        'Pull a full PitchBook picture of a company and write a diligence brief. Use before an investment, partnership, or competitive review.',
      content:
        '# Company Diligence Brief\n\nAssemble everything PitchBook holds on a company into one readable brief.\n\n## Steps\n1. Resolve the company to a PitchBook ID with a general search — names, websites, and tickers all work.\n2. Pull the bio for description, HQ, headcount, ownership status, and total raised.\n3. Pull industries and verticals to place the company in its market.\n4. Pull the full deal history and the latest financing round, then the latest reported financials.\n5. Pull all investors to see who is on the cap table and who has exited.\n6. Optionally pull similar companies to frame the competitive set.\n\n## Output\nReport funding trajectory, current backers, latest valuation, and how the company compares to its peers. Call out any section PitchBook returned no data for rather than inferring it.',
    },
    {
      name: 'investor-target-list',
      description:
        'Search PitchBook for investors whose stated preferences match a company, and rank them. Use for fundraising and outbound to capital partners.',
      content:
        '# Investor Target List\n\nFind the investors most likely to fund a given company.\n\n## Steps\n1. Translate the company profile into search filters — deal type, deal size, industry, vertical, and geography.\n2. Run an investor search, paging until enough candidates are collected.\n3. For each candidate pull investment preferences and confirm the check size and stage actually match.\n4. Pull recent investments to verify the investor is currently active, not dormant.\n5. Rank by fit and write the list to a table with the evidence for each match.\n\n## Output\nReport how many investors matched, the filters used, and why each top candidate fits. Flag any whose last investment is old enough to question whether they are still deploying.',
    },
    {
      name: 'deal-flow-digest',
      description:
        'Search PitchBook for deals matching a thesis over a time window and summarize them. Use for recurring deal-flow and market monitoring.',
      content:
        '# Deal Flow Digest\n\nTurn a PitchBook deal search into a readable market update.\n\n## Steps\n1. Express the thesis as deal search filters — deal type, size, date range, industry, vertical, and geography. Range filters carry their operator in the value, such as >2024-01-01 or 10^100.\n2. Run the search and page through the results.\n3. For notable deals pull the deal detail and the investor list to capture round size, valuation, and who led.\n4. Group the results by theme and summarize what moved.\n\n## Output\nReport the deal count, the total capital deployed, and the standout rounds with their lead investors. Note that each call spends PitchBook credits, so state how many were run.',
    },
    {
      name: 'benchmark-fund-performance',
      description:
        "Compare a fund's returns against its PitchBook peer benchmark and report the quartile. Use for LP monitoring and manager due diligence.",
      content:
        "# Benchmark Fund Performance\n\nPlace a fund's returns in context against its peer set.\n\n## Steps\n1. Resolve the fund to a PitchBook fund ID; fund IDs end in F.\n2. Pull the fund bio for vintage, type, size, and managers - these define the peer set.\n3. Pull the most recent performance for IRR, DPI, RVPI, TVPI, NAV, and quartile.\n4. Pull the fund benchmark for the peer IRR, DPI, TVPI, and RVPI, and note how many funds it is drawn from.\n5. Optionally pull cash flows for a specific quarter to show called capital, dry powder, and distributions.\n\n## Output\nReport each metric next to its benchmark and state the quartile plainly. Name the benchmark's vintage, type, size bucket, and fund count, since a thin benchmark makes the quartile weak evidence. Say so when performance data is simply not reported rather than treating it as zero.",
    },
    {
      name: 'screen-lp-allocations',
      description:
        "Compare a limited partner's actual asset allocation against its targets to find where it is under-allocated. Use to time a fundraising approach.",
      content:
        '# Screen LP Allocations\n\nFind limited partners with room to commit in your asset class.\n\n## Steps\n1. Search limited partners matching the profile - type, geography, and AUM.\n2. For each, pull actual allocations and target allocations.\n3. Compare the two per asset class; a class sitting below its target minimum is where new commitments are most likely.\n4. Pull commitment preferences to confirm preferred commitment size and fund types line up.\n5. Pull commitment totals by fund type to see how much they have already deployed.\n\n## Output\nRank the limited partners by the gap between actual and target allocation in your asset class, and give the evidence for each. Flag any where allocations are unreported so the gap cannot be computed.',
    },
  ],
} as const satisfies BlockMeta
