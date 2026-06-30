import { EnrichSoIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const EnrichBlock: BlockConfig = {
  type: 'enrich',
  name: 'Enrich',
  description: 'B2B data enrichment and LinkedIn intelligence with Enrich.so',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Access real-time B2B data intelligence with Enrich.so. Enrich profiles from email addresses, find work emails from LinkedIn, verify email deliverability, search for people and companies, and analyze LinkedIn post engagement.',
  docsLink: 'https://docs.enrich.so/',
  category: 'tools',
  integrationType: IntegrationType.Sales,
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
        { label: 'Search Jobs', id: 'search_jobs' },
        // LinkedIn Posts/Activities
        { label: 'Search Posts', id: 'search_posts' },
        { label: 'Get Post Details', id: 'get_post_details' },
        { label: 'Search Post Reactions', id: 'search_post_reactions' },
        { label: 'Search Post Reactions (by URL)', id: 'search_post_reactions_by_url' },
        { label: 'Search Post Comments', id: 'search_post_comments' },
        { label: 'Search Post Comments (by URL)', id: 'search_post_comments_by_url' },
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
      condition: { field: 'operation', value: ['search_posts', 'search_jobs'] },
      required: { field: 'operation', value: ['search_posts', 'search_jobs'] },
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
      id: 'jobLocation',
      title: 'Location',
      type: 'short-input',
      placeholder: 'London',
      condition: { field: 'operation', value: 'search_jobs' },
    },
    {
      id: 'timePosted',
      title: 'Time Posted',
      type: 'dropdown',
      options: [
        { label: 'Any time', id: '' },
        { label: 'Past 24 hours', id: 'past_24hrs' },
        { label: 'Past week', id: 'past_week' },
        { label: 'Past month', id: 'past_month' },
      ],
      condition: { field: 'operation', value: 'search_jobs' },
    },
    {
      id: 'jobTypes',
      title: 'Job Types',
      type: 'short-input',
      placeholder: 'full time, part time',
      condition: { field: 'operation', value: 'search_jobs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the job types to include',
        prompt:
          'Convert the request into a comma-separated list of LinkedIn job types (e.g., full time, part time, contract, internship, temporary). Return ONLY the comma-separated list - no explanations, no extra text.',
      },
    },
    {
      id: 'workplaceTypes',
      title: 'Workplace Types',
      type: 'short-input',
      placeholder: 'on site, remote',
      condition: { field: 'operation', value: 'search_jobs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the workplace types to include',
        prompt:
          'Convert the request into a comma-separated list of LinkedIn workplace types (on site, remote, hybrid). Return ONLY the comma-separated list - no explanations, no extra text.',
      },
    },
    {
      id: 'experienceLevels',
      title: 'Experience Levels',
      type: 'short-input',
      placeholder: 'internship, associate',
      condition: { field: 'operation', value: 'search_jobs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the experience levels to include',
        prompt:
          'Convert the request into a comma-separated list of LinkedIn experience levels (internship, entry level, associate, mid-senior level, director, executive). Return ONLY the comma-separated list - no explanations, no extra text.',
      },
    },
    {
      id: 'jobCompanyIds',
      title: 'Company IDs',
      type: 'short-input',
      placeholder: '2048, 3050',
      condition: { field: 'operation', value: 'search_jobs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the companies to filter by',
        prompt:
          'Convert the request into a comma-separated list of LinkedIn company IDs (numeric). Return ONLY the comma-separated list - no explanations, no extra text.',
      },
    },
    {
      id: 'start',
      title: 'Start Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'search_jobs' },
      mode: 'advanced',
    },

    {
      id: 'postUrl',
      title: 'LinkedIn Post URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/posts/...',
      condition: {
        field: 'operation',
        value: ['get_post_details', 'search_post_reactions_by_url', 'search_post_comments_by_url'],
      },
      required: {
        field: 'operation',
        value: ['get_post_details', 'search_post_reactions_by_url', 'search_post_comments_by_url'],
      },
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
      value: () => 'all',
      condition: {
        field: 'operation',
        value: ['search_post_reactions', 'search_post_reactions_by_url'],
      },
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
      value: () => 'posts',
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
          'search_post_reactions_by_url',
          'search_post_comments',
          'search_post_comments_by_url',
        ],
      },
      required: {
        field: 'operation',
        value: ['sales_pointer_people', 'search_post_reactions', 'search_post_reactions_by_url'],
      },
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
      'enrich_search_jobs',
      'enrich_search_posts',
      'enrich_get_post_details',
      'enrich_search_post_reactions',
      'enrich_search_post_reactions_by_url',
      'enrich_search_post_comments',
      'enrich_search_post_comments_by_url',
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
        if (operation === 'search_jobs') {
          parsedParams.location = rest.jobLocation
          parsedParams.jobLocation = undefined
          parsedParams.companyIds = rest.jobCompanyIds
          parsedParams.jobCompanyIds = undefined
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
        if (parsedParams.start) parsedParams.start = Number(parsedParams.start)
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

export const EnrichBlockMeta = {
  tags: ['enrichment'],
  url: 'https://www.enrich.so',
  templates: [
    {
      icon: EnrichSoIcon,
      title: 'Enrich CRM hydrator',
      prompt:
        'Build a workflow that watches new Salesforce leads, enriches each with Enrich.so contact data, and writes role, company size, and email to the lead record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: EnrichSoIcon,
      title: 'Enrich list cleaner',
      prompt:
        'Create a workflow that runs an outreach list through Enrich, removes invalid emails and disqualified roles, and writes the clean list to a sender table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: EnrichSoIcon,
      title: 'Enrich bulk-account researcher',
      prompt:
        'Build a workflow that takes a list of target accounts, enriches each with Enrich firmographic data, and writes a tables-based account brief for the sales team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: EnrichSoIcon,
      title: 'Enrich + Email Bison sender',
      prompt:
        'Create a workflow that runs Enrich on prospects then drafts and sends a personalized Email Bison sequence based on the enriched fields.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['emailbison'],
    },
    {
      icon: EnrichSoIcon,
      title: 'Enrich event-attendee researcher',
      prompt:
        'Build a workflow that takes the Luma event attendee list, enriches each via Enrich, and writes a per-attendee research brief for the sales team.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['luma'],
    },
    {
      icon: EnrichSoIcon,
      title: 'Enrich CRM gap-filler',
      prompt:
        'Create a scheduled workflow that finds HubSpot contacts missing key fields, runs Enrich, and fills in the gaps so reporting is complete.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: EnrichSoIcon,
      title: 'Enrich LinkedIn role validator',
      prompt:
        'Build a scheduled workflow that reads HubSpot contacts with a LinkedIn profile URL, re-enriches each with Enrich, flags outdated roles, and updates the contact record with the current title.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['hubspot'],
    },
  ],
  skills: [
    {
      name: 'enrich-contact-from-email',
      description:
        'Enrich a person from their email address — name, role, company, social profiles, and more.',
      content:
        '# Enrich Contact from Email\n\nTurn an email address into a full contact profile using Enrich.so.\n\n## Steps\n1. Take the email address. Choose Email to Profile for a full enrichment, or Email to Person (Lite) for a fast, cheaper lookup.\n2. Enable fresh-data fetch when up-to-date info matters more than speed.\n3. Read back name, current title, company, location, and any LinkedIn or social URLs.\n\n## Output\nReturn the enriched fields in a clean object. Note which fields could not be resolved so downstream steps know what is missing, and report remaining credits if relevant.',
    },
    {
      name: 'find-and-verify-work-email',
      description:
        'Find a prospect work email from a name and company or LinkedIn URL, then verify deliverability.',
      content:
        '# Find and Verify Work Email\n\nLocate a reliable work email for a prospect and confirm it is safe to send to.\n\n## Steps\n1. If you have a name and company domain, use Find Email. If you have a LinkedIn profile URL, use LinkedIn to Work Email instead.\n2. Run Verify Email on the returned address to check deliverability, and Disposable Email Check to rule out throwaway domains.\n3. If the work email cannot be found, optionally fall back to LinkedIn to Personal Email when appropriate.\n\n## Output\nReturn the discovered email, its verification status (valid, risky, invalid), and whether it is disposable. Recommend whether the address is safe to add to outreach.',
    },
    {
      name: 'enrich-company-firmographics',
      description:
        'Look up firmographic data for a company — size, industry, funding, revenue, and traffic.',
      content:
        '# Enrich Company Firmographics\n\nBuild a firmographic profile for a target account using Enrich.so.\n\n## Steps\n1. Identify the company by name or domain. Use Company Lookup for core firmographics.\n2. Add Company Funding & Traffic and Company Revenue for deeper financial signals when account scoring needs them.\n3. If you only have a visitor IP, use IP to Company first to resolve the organization.\n\n## Output\nReturn a consolidated account brief: company name, domain, industry, employee count, funding, revenue, and traffic. Flag any data points that could not be resolved.',
    },
    {
      name: 'search-prospects',
      description:
        'Search Enrich.so for people or companies matching an ideal-customer-profile filter.',
      content:
        '# Search Prospects\n\nFind people or companies that match a target profile.\n\n## Steps\n1. For people, use Search People with filters like job title, industry, location, and skills. For companies, use Search Company with industry, location, and employee-size bounds.\n2. To pull contacts at known accounts, use Search Company Employees with the company IDs and target job titles.\n3. Page through results using the page and page-size parameters until you have enough matches.\n\n## Output\nReturn the matching people or companies with their key identifying fields and any profile URLs, plus a count of total matches. Suggest tighter filters if too many or too few results come back.',
    },
  ],
} as const satisfies BlockMeta
