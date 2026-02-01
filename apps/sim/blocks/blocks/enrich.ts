import { EnrichSoIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const EnrichBlock: BlockConfig = {
  type: 'enrich',
  name: 'Enrich',
  description: 'B2B data enrichment and LinkedIn intelligence with Enrich.so',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Access real-time B2B data intelligence with Enrich.so. Enrich profiles from email addresses, find work emails from LinkedIn, verify email deliverability, search for people and companies, and analyze LinkedIn post engagement.',
  docsLink: 'https://docs.enrich.so/',
  category: 'tools',
  bgColor: '#E5E5E6',
  icon: EnrichSoIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Person/Profile Enrichment
        { label: 'Email to Profile', id: 'email_to_profile' },
        { label: 'Email to Person (Lite)', id: 'email_to_person_lite' },
        { label: 'LinkedIn Profile Enrichment', id: 'linkedin_profile' },
        // Email Finding
        { label: 'Find Email', id: 'find_email' },
        { label: 'LinkedIn to Work Email', id: 'linkedin_to_work_email' },
        { label: 'LinkedIn to Personal Email', id: 'linkedin_to_personal_email' },
        // Phone Finding
        { label: 'Phone Finder (LinkedIn)', id: 'phone_finder' },
        { label: 'Email to Phone', id: 'email_to_phone' },
        // Email Verification
        { label: 'Verify Email', id: 'verify_email' },
        { label: 'Disposable Email Check', id: 'disposable_email_check' },
        // IP/Company Lookup
        { label: 'Email to IP', id: 'email_to_ip' },
        { label: 'IP to Company', id: 'ip_to_company' },
        // Company Enrichment
        { label: 'Company Lookup', id: 'company_lookup' },
        { label: 'Company Funding & Traffic', id: 'company_funding' },
        { label: 'Company Revenue', id: 'company_revenue' },
        // Search
        { label: 'Search People', id: 'search_people' },
        { label: 'Search Company', id: 'search_company' },
        { label: 'Search Company Employees', id: 'search_company_employees' },
        { label: 'Search Similar Companies', id: 'search_similar_companies' },
        { label: 'Sales Pointer (People)', id: 'sales_pointer_people' },
        // LinkedIn Posts/Activities
        { label: 'Search Posts', id: 'search_posts' },
        { label: 'Get Post Details', id: 'get_post_details' },
        { label: 'Search Post Reactions', id: 'search_post_reactions' },
        { label: 'Search Post Comments', id: 'search_post_comments' },
        { label: 'Search People Activities', id: 'search_people_activities' },
        { label: 'Search Company Activities', id: 'search_company_activities' },
        // Other
        { label: 'Reverse Hash Lookup', id: 'reverse_hash_lookup' },
        { label: 'Search Logo', id: 'search_logo' },
        { label: 'Check Credits', id: 'check_credits' },
      ],
      value: () => 'email_to_profile',
    },
    {
      id: 'apiKey',
      title: 'Enrich API Key',
      type: 'short-input',
      placeholder: 'Enter your Enrich.so API key',
      password: true,
      required: true,
    },

    {
      id: 'email',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'john.doe@company.com',
      condition: {
        field: 'operation',
        value: [
          'email_to_profile',
          'email_to_person_lite',
          'email_to_phone',
          'verify_email',
          'disposable_email_check',
          'email_to_ip',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'email_to_profile',
          'email_to_person_lite',
          'email_to_phone',
          'verify_email',
          'disposable_email_check',
          'email_to_ip',
        ],
      },
    },

    {
      id: 'inRealtime',
      title: 'Fetch Fresh Data',
      type: 'switch',
      condition: { field: 'operation', value: 'email_to_profile' },
      mode: 'advanced',
    },

    {
      id: 'linkedinUrl',
      title: 'LinkedIn Profile URL',
      type: 'short-input',
      placeholder: 'linkedin.com/in/williamhgates',
      condition: {
        field: 'operation',
        value: [
          'linkedin_profile',
          'linkedin_to_work_email',
          'linkedin_to_personal_email',
          'phone_finder',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'linkedin_profile',
          'linkedin_to_work_email',
          'linkedin_to_personal_email',
          'phone_finder',
        ],
      },
    },

    {
      id: 'fullName',
      title: 'Full Name',
      type: 'short-input',
      placeholder: 'John Doe',
      condition: { field: 'operation', value: 'find_email' },
      required: { field: 'operation', value: 'find_email' },
    },
    {
      id: 'companyDomain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: 'find_email' },
      required: { field: 'operation', value: 'find_email' },
    },

    {
      id: 'ip',
      title: 'IP Address',
      type: 'short-input',
      placeholder: '86.92.60.221',
      condition: { field: 'operation', value: 'ip_to_company' },
      required: { field: 'operation', value: 'ip_to_company' },
    },

    {
      id: 'companyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Google',
      condition: { field: 'operation', value: 'company_lookup' },
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'google.com',
      condition: {
        field: 'operation',
        value: ['company_lookup', 'company_funding', 'company_revenue', 'search_logo'],
      },
      required: {
        field: 'operation',
        value: ['company_funding', 'company_revenue', 'search_logo'],
      },
    },

    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'John',
      condition: { field: 'operation', value: 'search_people' },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      condition: { field: 'operation', value: 'search_people' },
    },
    {
      id: 'subTitle',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'Software Engineer',
      condition: { field: 'operation', value: 'search_people' },
    },
    {
      id: 'locationCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'United States',
      condition: { field: 'operation', value: ['search_people', 'search_company'] },
    },
    {
      id: 'locationCity',
      title: 'City',
      type: 'short-input',
      placeholder: 'San Francisco',
      condition: { field: 'operation', value: ['search_people', 'search_company'] },
    },
    {
      id: 'industry',
      title: 'Industry',
      type: 'short-input',
      placeholder: 'Technology',
      condition: { field: 'operation', value: 'search_people' },
    },
    {
      id: 'currentJobTitles',
      title: 'Current Job Titles (JSON)',
      type: 'code',
      placeholder: '["CEO", "CTO", "VP Engineering"]',
      condition: { field: 'operation', value: 'search_people' },
    },
    {
      id: 'skills',
      title: 'Skills (JSON)',
      type: 'code',
      placeholder: '["Python", "Machine Learning"]',
      condition: { field: 'operation', value: 'search_people' },
    },

    {
      id: 'searchCompanyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Google',
      condition: { field: 'operation', value: 'search_company' },
    },
    {
      id: 'industries',
      title: 'Industries (JSON)',
      type: 'code',
      placeholder: '["Technology", "Software"]',
      condition: { field: 'operation', value: 'search_company' },
    },
    {
      id: 'staffCountMin',
      title: 'Min Employees',
      type: 'short-input',
      placeholder: '50',
      condition: { field: 'operation', value: 'search_company' },
    },
    {
      id: 'staffCountMax',
      title: 'Max Employees',
      type: 'short-input',
      placeholder: '500',
      condition: { field: 'operation', value: 'search_company' },
    },

    {
      id: 'companyIds',
      title: 'Company IDs (JSON)',
      type: 'code',
      placeholder: '[12345, 67890]',
      condition: { field: 'operation', value: 'search_company_employees' },
    },
    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'United States',
      condition: { field: 'operation', value: 'search_company_employees' },
    },
    {
      id: 'city',
      title: 'City',
      type: 'short-input',
      placeholder: 'San Francisco',
      condition: { field: 'operation', value: 'search_company_employees' },
    },
    {
      id: 'jobTitles',
      title: 'Job Titles (JSON)',
      type: 'code',
      placeholder: '["Software Engineer", "Product Manager"]',
      condition: { field: 'operation', value: 'search_company_employees' },
    },

    {
      id: 'linkedinCompanyUrl',
      title: 'LinkedIn Company URL',
      type: 'short-input',
      placeholder: 'linkedin.com/company/google',
      condition: { field: 'operation', value: 'search_similar_companies' },
      required: { field: 'operation', value: 'search_similar_companies' },
    },
    {
      id: 'accountLocation',
      title: 'Locations (JSON)',
      type: 'code',
      placeholder: '["germany", "france"]',
      condition: { field: 'operation', value: 'search_similar_companies' },
    },
    {
      id: 'employeeSizeType',
      title: 'Employee Size Filter Type',
      type: 'dropdown',
      options: [
        { label: 'Range', id: 'RANGE' },
        { label: 'Exact', id: 'EXACT' },
      ],
      condition: { field: 'operation', value: 'search_similar_companies' },
      mode: 'advanced',
    },
    {
      id: 'employeeSizeRange',
      title: 'Employee Size Range (JSON)',
      type: 'code',
      placeholder: '[{"start": 50, "end": 200}]',
      condition: { field: 'operation', value: 'search_similar_companies' },
    },
    {
      id: 'num',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'search_similar_companies' },
    },

    {
      id: 'filters',
      title: 'Filters (JSON)',
      type: 'code',
      placeholder:
        '[{"type": "POSTAL_CODE", "values": [{"id": "101041448", "text": "San Francisco", "selectionType": "INCLUDED"}]}]',
      condition: { field: 'operation', value: 'sales_pointer_people' },
      required: { field: 'operation', value: 'sales_pointer_people' },
    },

    {
      id: 'keywords',
      title: 'Keywords',
      type: 'short-input',
      placeholder: 'AI automation',
      condition: { field: 'operation', value: 'search_posts' },
      required: { field: 'operation', value: 'search_posts' },
    },
    {
      id: 'datePosted',
      title: 'Date Posted',
      type: 'dropdown',
      options: [
        { label: 'Any time', id: '' },
        { label: 'Past 24 hours', id: 'past_24_hours' },
        { label: 'Past week', id: 'past_week' },
        { label: 'Past month', id: 'past_month' },
      ],
      condition: { field: 'operation', value: 'search_posts' },
    },

    {
      id: 'postUrl',
      title: 'LinkedIn Post URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/posts/...',
      condition: { field: 'operation', value: 'get_post_details' },
      required: { field: 'operation', value: 'get_post_details' },
    },

    {
      id: 'postUrn',
      title: 'Post URN',
      type: 'short-input',
      placeholder: 'urn:li:activity:7231931952839196672',
      condition: {
        field: 'operation',
        value: ['search_post_reactions', 'search_post_comments'],
      },
      required: {
        field: 'operation',
        value: ['search_post_reactions', 'search_post_comments'],
      },
    },
    {
      id: 'reactionType',
      title: 'Reaction Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Like', id: 'like' },
        { label: 'Love', id: 'love' },
        { label: 'Celebrate', id: 'celebrate' },
        { label: 'Insightful', id: 'insightful' },
        { label: 'Funny', id: 'funny' },
      ],
      condition: { field: 'operation', value: 'search_post_reactions' },
    },

    {
      id: 'profileId',
      title: 'Profile ID',
      type: 'short-input',
      placeholder: 'ACoAAC1wha0BhoDIRAHrP5rgzVDyzmSdnl-KuEk',
      condition: { field: 'operation', value: 'search_people_activities' },
      required: { field: 'operation', value: 'search_people_activities' },
    },
    {
      id: 'activityType',
      title: 'Activity Type',
      type: 'dropdown',
      options: [
        { label: 'Posts', id: 'posts' },
        { label: 'Comments', id: 'comments' },
        { label: 'Articles', id: 'articles' },
      ],
      condition: {
        field: 'operation',
        value: ['search_people_activities', 'search_company_activities'],
      },
    },

    {
      id: 'companyId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: '100746430',
      condition: { field: 'operation', value: 'search_company_activities' },
      required: { field: 'operation', value: 'search_company_activities' },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'search_company_activities' },
      mode: 'advanced',
    },

    {
      id: 'hash',
      title: 'MD5 Hash',
      type: 'short-input',
      placeholder: '5f0efb20de5ecfedbe0bf5e7c12353fe',
      condition: { field: 'operation', value: 'reverse_hash_lookup' },
      required: { field: 'operation', value: 'reverse_hash_lookup' },
    },

    {
      id: 'page',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: {
        field: 'operation',
        value: [
          'search_people',
          'search_company',
          'search_company_employees',
          'search_similar_companies',
          'sales_pointer_people',
          'search_posts',
          'search_post_reactions',
          'search_post_comments',
        ],
      },
      required: { field: 'operation', value: 'sales_pointer_people' },
    },
    {
      id: 'pageSize',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: '20',
      condition: {
        field: 'operation',
        value: ['search_people', 'search_company', 'search_company_employees'],
      },
    },
    {
      id: 'paginationToken',
      title: 'Pagination Token',
      type: 'short-input',
      placeholder: 'Token from previous response',
      condition: {
        field: 'operation',
        value: ['search_people_activities', 'search_company_activities'],
      },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'enrich_check_credits',
      'enrich_email_to_profile',
      'enrich_email_to_person_lite',
      'enrich_linkedin_profile',
      'enrich_find_email',
      'enrich_linkedin_to_work_email',
      'enrich_linkedin_to_personal_email',
      'enrich_phone_finder',
      'enrich_email_to_phone',
      'enrich_verify_email',
      'enrich_disposable_email_check',
      'enrich_email_to_ip',
      'enrich_ip_to_company',
      'enrich_company_lookup',
      'enrich_company_funding',
      'enrich_company_revenue',
      'enrich_search_people',
      'enrich_search_company',
      'enrich_search_company_employees',
      'enrich_search_similar_companies',
      'enrich_sales_pointer_people',
      'enrich_search_posts',
      'enrich_get_post_details',
      'enrich_search_post_reactions',
      'enrich_search_post_comments',
      'enrich_search_people_activities',
      'enrich_search_company_activities',
      'enrich_reverse_hash_lookup',
      'enrich_search_logo',
    ],
    config: {
      tool: (params) => `enrich_${params.operation}`,
      params: (params) => {
        const { operation, ...rest } = params
        const parsedParams: Record<string, any> = { ...rest }

        try {
          if (rest.currentJobTitles && typeof rest.currentJobTitles === 'string') {
            parsedParams.currentJobTitles = JSON.parse(rest.currentJobTitles)
          }
          if (rest.skills && typeof rest.skills === 'string') {
            parsedParams.skills = JSON.parse(rest.skills)
          }
          if (rest.industries && typeof rest.industries === 'string') {
            parsedParams.industries = JSON.parse(rest.industries)
          }
          if (rest.companyIds && typeof rest.companyIds === 'string') {
            parsedParams.companyIds = JSON.parse(rest.companyIds)
          }
          if (rest.jobTitles && typeof rest.jobTitles === 'string') {
            parsedParams.jobTitles = JSON.parse(rest.jobTitles)
          }
          if (rest.accountLocation && typeof rest.accountLocation === 'string') {
            parsedParams.accountLocation = JSON.parse(rest.accountLocation)
          }
          if (rest.employeeSizeRange && typeof rest.employeeSizeRange === 'string') {
            parsedParams.employeeSizeRange = JSON.parse(rest.employeeSizeRange)
          }
          if (rest.filters && typeof rest.filters === 'string') {
            parsedParams.filters = JSON.parse(rest.filters)
          }
        } catch (error: any) {
          throw new Error(`Invalid JSON input: ${error.message}`)
        }

        if (operation === 'linkedin_profile') {
          parsedParams.url = rest.linkedinUrl
          parsedParams.linkedinUrl = undefined
        }
        if (
          operation === 'linkedin_to_work_email' ||
          operation === 'linkedin_to_personal_email' ||
          operation === 'phone_finder'
        ) {
          parsedParams.linkedinProfile = rest.linkedinUrl
          parsedParams.linkedinUrl = undefined
        }
        if (operation === 'company_lookup') {
          parsedParams.name = rest.companyName
          parsedParams.companyName = undefined
        }
        if (operation === 'search_company') {
          parsedParams.name = rest.searchCompanyName
          parsedParams.searchCompanyName = undefined
        }
        if (operation === 'search_similar_companies') {
          parsedParams.url = rest.linkedinCompanyUrl
          parsedParams.linkedinCompanyUrl = undefined
        }
        if (operation === 'get_post_details') {
          parsedParams.url = rest.postUrl
          parsedParams.postUrl = undefined
        }
        if (operation === 'search_logo') {
          parsedParams.url = rest.domain
        }

        if (parsedParams.page) {
          const pageNum = Number(parsedParams.page)
          if (operation === 'search_people' || operation === 'search_company') {
            parsedParams.currentPage = pageNum
            parsedParams.page = undefined
          } else {
            parsedParams.page = pageNum
          }
        }
        if (parsedParams.pageSize) parsedParams.pageSize = Number(parsedParams.pageSize)
        if (parsedParams.num) parsedParams.num = Number(parsedParams.num)
        if (parsedParams.offset) parsedParams.offset = Number(parsedParams.offset)
        if (parsedParams.staffCountMin)
          parsedParams.staffCountMin = Number(parsedParams.staffCountMin)
        if (parsedParams.staffCountMax)
          parsedParams.staffCountMax = Number(parsedParams.staffCountMax)

        return parsedParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Enrich operation to perform' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the operation was successful' },
    output: { type: 'json', description: 'Output data from the Enrich operation' },
  },
}
