import { RestCountriesIcon } from '@/components/icons'
import { type BlockConfig, IntegrationType } from '@/blocks/types'
import type { RestCountriesResponse } from '@/tools/restcountries/types'

export const RestCountriesBlock: BlockConfig<RestCountriesResponse> = {
  type: 'restcountries',
  name: 'REST Countries',
  description: 'Look up country reference data',
  longDescription:
    'Look up country information using the REST Countries API. Search by name, code, region, currency, or language. Does not require OAuth or an API key.',
  docsLink: 'https://docs.sim.ai/tools/restcountries',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  tags: ['data-analytics', 'knowledge-base'],
  bgColor: '#E8F2FF',
  icon: RestCountriesIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search by Name', id: 'restcountries_search_by_name' },
        { label: 'Get by Code', id: 'restcountries_get_by_code' },
        { label: 'List by Region', id: 'restcountries_list_by_region' },
        { label: 'List by Currency', id: 'restcountries_list_by_currency' },
        { label: 'List by Language', id: 'restcountries_list_by_language' },
      ],
      value: () => 'restcountries_search_by_name',
    },
    {
      id: 'name',
      title: 'Country Name',
      type: 'short-input',
      placeholder: 'Canada',
      condition: { field: 'operation', value: 'restcountries_search_by_name' },
      required: { field: 'operation', value: 'restcountries_search_by_name' },
    },
    {
      id: 'fullText',
      title: 'Exact Match',
      type: 'switch',
      condition: { field: 'operation', value: 'restcountries_search_by_name' },
      mode: 'advanced',
    },
    {
      id: 'code',
      title: 'Country Code',
      type: 'short-input',
      placeholder: 'US, USA, 840',
      condition: { field: 'operation', value: 'restcountries_get_by_code' },
      required: { field: 'operation', value: 'restcountries_get_by_code' },
    },
    {
      id: 'region',
      title: 'Region',
      type: 'dropdown',
      options: [
        { label: 'Africa', id: 'Africa' },
        { label: 'Americas', id: 'Americas' },
        { label: 'Asia', id: 'Asia' },
        { label: 'Europe', id: 'Europe' },
        { label: 'Oceania', id: 'Oceania' },
      ],
      value: () => 'Europe',
      condition: { field: 'operation', value: 'restcountries_list_by_region' },
      required: { field: 'operation', value: 'restcountries_list_by_region' },
    },
    {
      id: 'currency',
      title: 'Currency',
      type: 'short-input',
      placeholder: 'USD, EUR, dollar',
      condition: { field: 'operation', value: 'restcountries_list_by_currency' },
      required: { field: 'operation', value: 'restcountries_list_by_currency' },
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'English, Spanish, en',
      condition: { field: 'operation', value: 'restcountries_list_by_language' },
      required: { field: 'operation', value: 'restcountries_list_by_language' },
    },
  ],
  tools: {
    access: [
      'restcountries_search_by_name',
      'restcountries_get_by_code',
      'restcountries_list_by_region',
      'restcountries_list_by_currency',
      'restcountries_list_by_language',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'restcountries_get_by_code':
            return 'restcountries_get_by_code'
          case 'restcountries_list_by_region':
            return 'restcountries_list_by_region'
          case 'restcountries_list_by_currency':
            return 'restcountries_list_by_currency'
          case 'restcountries_list_by_language':
            return 'restcountries_list_by_language'
          default:
            return 'restcountries_search_by_name'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Country lookup operation to perform' },
    name: { type: 'string', description: 'Country name to search for' },
    fullText: { type: 'boolean', description: 'Require an exact country-name match' },
    code: { type: 'string', description: 'Country code to look up' },
    region: { type: 'string', description: 'World region to list countries from' },
    currency: { type: 'string', description: 'Currency code or name to search for' },
    language: { type: 'string', description: 'Language code or name to search for' },
  },
  outputs: {
    countries: { type: 'json', description: 'Countries returned by REST Countries' },
    count: { type: 'number', description: 'Number of countries returned' },
    firstCountry: { type: 'json', description: 'First country in the returned list' },
  },
}
