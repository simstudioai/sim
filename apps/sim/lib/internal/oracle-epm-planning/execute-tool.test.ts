/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), validate: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.validate,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: vi.fn(),
  storeOracleEpmDownload: vi.fn(),
}))

import { executeOracleEpmPlanningTool } from '@/lib/internal/oracle-epm-planning/execute-tool'
import {
  assertPlanningPayload,
  dimensionSchema,
  formDataSchema,
  interopStatusSchema,
  jobSchema,
  memberSchema,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type { OracleEpmPlanningResponse } from '@/tools/oracle_epm_planning/types'

const AUTH = {
  oauthCredential: 'credential-1',
  accessToken: Buffer.from('fixture:password').toString('base64'),
  instanceUrl: 'https://epm.example.com',
}
/** Fixtures are projections of the linked Oracle examples, not claims of live tenant verification. */
const CASES: {
  operation: string
  source: string
  input: Record<string, unknown>
  method: string
  path: string
  response: unknown
  output: string
  body?: unknown
  form?: Record<string, string>
  query?: Record<string, string>
}[] = [
  {
    operation: 'list_applications',
    source: 'get_applications.html',
    input: {},
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications',
    response: {
      items: [
        {
          name: 'Vision',
          unicode: true,
          adminMode: 'false',
          hybrid: 'true',
        },
      ],
    },
    output: 'applications',
  },
  {
    operation: 'list_cubes',
    source: 'get_plan_types.html',
    input: {
      application: 'Vision',
    },
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications/Vision/plantypes',
    response: {
      items: [
        {
          planTypeName: 'Plan1',
          planType: 1,
          cubeName: 'Plan1',
          numDimensions: 12,
          cubeType: 0,
        },
      ],
    },
    output: 'cubes',
  },
  {
    operation: 'list_dimensions',
    source: 'get_dim_plan_types.html',
    input: {
      application: 'Vision',
      cube: 'Plan1',
    },
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications/Vision/plantypes/Plan1/dimensions',
    response: {
      items: [
        {
          name: 'Account',
          id: '1',
          level: 0,
          dimType: 'Account',
        },
      ],
      totalResults: 1,
      hasMore: false,
    },
    output: 'dimensions',
    query: {
      offset: '0',
      limit: '100',
    },
  },
  {
    operation: 'get_dimension',
    source: 'get_dim_details.html',
    input: {
      application: 'Vision',
      cube: 'Plan1',
      dimension: 'Account',
    },
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications/Vision/plantypes/Plan1/dimensions/Account',
    response: {
      name: 'Account',
      id: '1',
      level: 0,
      dimType: 'Account',
      children: [
        {
          name: 'Sales',
          parentName: 'Account',
        },
      ],
    },
    output: 'dimension',
  },
  {
    operation: 'get_member',
    source: 'get_member.html',
    input: {
      application: 'Vision',
      dimension: 'Account',
      memberName: 'Sales',
    },
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications/Vision/dimensions/Account/members/Sales',
    response: {
      name: 'Sales',
      description: null,
      parentName: 'Account',
      dimName: 'Account',
      dataType: 'UNSPECIFIED',
      dataStorage: 'STOREDATA',
      objectType: 33,
      twoPass: false,
    },
    output: 'member',
  },
  {
    operation: 'add_member',
    source: 'add_member.html',
    input: {
      application: 'Vision',
      dimension: 'Account',
      memberName: 'Sales',
      parentName: 'Account',
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/dimensions/Account/members',
    response: {
      name: 'Sales',
      description: null,
      parentName: 'Account',
      dimName: 'Account',
      dataType: 'UNSPECIFIED',
      dataStorage: 'STOREDATA',
      objectType: 33,
      twoPass: false,
    },
    output: 'member',
    body: {
      memberName: 'Sales',
      parentName: 'Account',
    },
  },
  {
    operation: 'list_substitution_variables',
    source: 'planning_get_all_subst_variables_for_app_1.html',
    input: {
      application: 'Vision',
    },
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications/Vision/substitutionvariables',
    response: {
      items: [
        {
          name: 'CurrentYear',
          value: 'FY26',
          planType: 'ALL',
        },
      ],
    },
    output: 'variables',
  },
  {
    operation: 'get_substitution_variable',
    source: 'planning_get_a_subst_variable_for_app_2.html',
    input: {
      application: 'Vision',
      variableName: 'CurrentYear',
    },
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications/Vision/substitutionvariables/CurrentYear',
    response: {
      name: 'CurrentYear',
      value: 'FY26',
      planType: 'ALL',
    },
    output: 'variable',
  },
  {
    operation: 'set_substitution_variables',
    source: 'planning_create_or_replace_all_subst_variables_for_app_3.html',
    input: {
      application: 'Vision',
      variables: [
        {
          name: 'CurrentYear',
          value: 'FY26',
          planType: 'ALL',
        },
      ],
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/substitutionvariables',
    response: null,
    output: 'updated',
    body: {
      items: [
        {
          name: 'CurrentYear',
          value: 'FY26',
          planType: 'ALL',
        },
      ],
    },
  },
  {
    operation: 'delete_substitution_variable',
    source: 'planning_del_a_subst_variable_for_app.html',
    input: {
      application: 'Vision',
      variableName: 'CurrentYear',
    },
    method: 'DELETE',
    path: '/HyperionPlanning/rest/v3/applications/Vision/substitutionvariables/CurrentYear',
    response: null,
    output: 'deleted',
  },
  {
    operation: 'list_job_definitions',
    source: 'get_job_definitions.html',
    input: {
      application: 'Vision',
    },
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications/Vision/jobdefinitions',
    response: {
      items: [
        {
          jobName: 'Calculate',
          jobType: 'RULES',
          links: null,
        },
      ],
    },
    output: 'jobDefinitions',
  },
  {
    operation: 'run_job',
    source: 'execute_a_job.html',
    input: {
      application: 'Vision',
      jobType: 'RULES',
      jobName: 'Calculate',
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/jobs',
    response: {
      jobId: 42,
      status: 0,
      details: null,
      jobName: 'Calculate',
      descriptiveStatus: 'Completed',
    },
    output: 'job',
    body: {
      jobType: 'RULES',
      jobName: 'Calculate',
    },
  },
  {
    operation: 'run_rule',
    source: 'rules.html',
    input: {
      application: 'Vision',
      jobName: 'Calculate',
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/jobs',
    response: {
      jobId: 42,
      status: 0,
      details: null,
      jobName: 'Calculate',
      descriptiveStatus: 'Completed',
    },
    output: 'job',
    body: {
      jobType: 'RULES',
      jobName: 'Calculate',
    },
  },
  {
    operation: 'run_ruleset',
    source: 'ruleset.html',
    input: {
      application: 'Vision',
      jobName: 'Calculate',
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/jobs',
    response: {
      jobId: 42,
      status: 0,
      details: null,
      jobName: 'Calculate',
      descriptiveStatus: 'Completed',
    },
    output: 'job',
    body: {
      jobType: 'RULESET',
      jobName: 'Calculate',
    },
  },
  {
    operation: 'get_job',
    source: 'retrieve_job_status.html',
    input: {
      application: 'Vision',
      jobId: '42',
    },
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications/Vision/jobs/42',
    response: {
      jobId: 42,
      status: 0,
      details: null,
      jobName: 'Calculate',
      descriptiveStatus: 'Completed',
    },
    output: 'job',
  },
  {
    operation: 'wait_for_job',
    source: 'retrieve_job_status.html',
    input: {
      application: 'Vision',
      jobId: '42',
    },
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications/Vision/jobs/42',
    response: {
      jobId: 42,
      status: 0,
      details: null,
      jobName: 'Calculate',
      descriptiveStatus: 'Completed',
    },
    output: 'job',
  },
  {
    operation: 'get_job_details',
    source: 'retrieve_job_status_details.html',
    input: {
      application: 'Vision',
      jobId: '42',
    },
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications/Vision/jobs/42/details',
    response: {
      items: [
        {
          recordsRead: 5,
          recordsRejected: 1,
          recordsProcessed: 4,
          dimensionName: 'Account',
          loadType: 'Data',
        },
      ],
    },
    output: 'jobDetails',
    query: {
      offset: '0',
      limit: '100',
    },
  },
  {
    operation: 'export_data_slice',
    source: 'export_dataslices.html',
    input: {
      application: 'Vision',
      cube: 'Plan1',
      gridDefinition: {
        pov: {
          members: [['FY26']],
        },
        columns: [
          {
            members: [['Jan']],
          },
        ],
        rows: [
          {
            members: [['Sales']],
          },
        ],
      },
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/plantypes/Plan1/exportdataslice',
    response: {
      pov: ['FY26'],
      columns: [['Jan']],
      rows: [
        {
          headers: ['Sales'],
          data: ['120'],
        },
      ],
    },
    output: 'dataGrid',
    body: {
      exportPlanningData: false,
      gridDefinition: {
        pov: {
          members: [['FY26']],
        },
        columns: [
          {
            members: [['Jan']],
          },
        ],
        rows: [
          {
            members: [['Sales']],
          },
        ],
      },
    },
  },
  {
    operation: 'import_data_slice',
    source: 'import_dataslices.html',
    input: {
      application: 'Vision',
      cube: 'Plan1',
      dataGrid: {
        pov: ['FY26'],
        columns: [['Jan']],
        rows: [
          {
            headers: ['Sales'],
            data: ['120'],
          },
        ],
      },
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/plantypes/Plan1/importdataslice',
    response: {
      numAcceptedCells: 1,
      numUpdateCells: 1,
      numRejectedCells: 0,
      rejectedCells: [],
      rejectedCellsWithDetails: [],
    },
    output: 'importResult',
    body: {
      dataGrid: {
        pov: ['FY26'],
        columns: [['Jan']],
        rows: [
          {
            headers: ['Sales'],
            data: ['120'],
          },
        ],
      },
      customParams: {
        IncludeRejectedCells: true,
        IncludeRejectedCellsWithDetails: true,
      },
    },
  },
  {
    operation: 'clear_data_slice',
    source: 'clear_dataslices.html',
    input: {
      application: 'Vision',
      cube: 'Plan1',
      gridDefinition: {
        pov: {
          members: [['FY26']],
        },
        columns: [
          {
            members: [['Jan']],
          },
        ],
        rows: [
          {
            members: [['Sales']],
          },
        ],
      },
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/plantypes/Plan1/cleardataslice',
    response: {
      numClearedCells: 1,
      numRejectedCells: 0,
      rejectedCells: [],
    },
    output: 'clearResult',
    body: {
      gridDefinition: {
        pov: {
          members: [['FY26']],
        },
        columns: [
          {
            members: [['Jan']],
          },
        ],
        rows: [
          {
            members: [['Sales']],
          },
        ],
      },
      clearEssbaseData: true,
      clearPlanningData: false,
    },
  },
  {
    operation: 'export_form_data',
    source: 'get_export_form_data.html',
    input: {
      application: 'Vision',
      form: 'Budget',
    },
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications/Vision/forms/Budget/data',
    response: {
      gridInfo: {
        pageDimNames: ['Scenario'],
        allowedPageMembersByDim: {
          Scenario: ['Plan'],
        },
        rowDimNames: ['Account'],
        columnDimNames: ['Period'],
      },
      pov: {
        Scenario: 'Plan',
      },
      columns: [['Jan']],
      rows: [
        {
          headers: ['Sales'],
          data: [120],
        },
      ],
    },
    output: 'formData',
    query: {
      displayMemberAs: 'MEMBER_NAME',
      memberAliasDelimiter: ':',
      forceStartExpanded: 'false',
    },
  },
  {
    operation: 'export_application_data',
    source: 'export_data.html',
    input: {
      application: 'Vision',
      jobName: 'Calculate',
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/jobs',
    response: {
      jobId: 42,
      status: 0,
      details: null,
      jobName: 'Calculate',
      descriptiveStatus: 'Completed',
    },
    output: 'job',
    body: {
      jobType: 'EXPORT_DATA',
      jobName: 'Calculate',
      parameters: {},
    },
  },
  {
    operation: 'import_application_data',
    source: 'import_data.html',
    input: {
      application: 'Vision',
      jobName: 'Calculate',
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/jobs',
    response: {
      jobId: 42,
      status: 0,
      details: null,
      jobName: 'Calculate',
      descriptiveStatus: 'Completed',
    },
    output: 'job',
    body: {
      jobType: 'IMPORT_DATA',
      jobName: 'Calculate',
      parameters: {},
    },
  },
  {
    operation: 'list_files',
    source: 'list_files_v2.html',
    input: {},
    method: 'GET',
    path: '/interop/rest/v2/files/list',
    response: {
      status: 0,
      details: null,
      items: [
        {
          name: 'data.csv',
          type: 'EXTERNAL',
          size: '3',
          lastmodifiedtime: '1422547859155',
        },
      ],
    },
    output: 'files',
  },
  {
    operation: 'delete_file',
    source: 'delete_files_v2.html',
    input: {
      fileName: 'data.csv',
    },
    method: 'DELETE',
    path: '/interop/rest/v2/files/delete',
    response: {
      status: 0,
      details: null,
    },
    output: 'deleted',
    body: {
      fileName: 'data.csv',
    },
  },
  {
    operation: 'refresh_cube',
    source: 'cube_refresh.html',
    input: {
      application: 'Vision',
      jobName: 'Calculate',
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/jobs',
    response: {
      jobId: 42,
      status: 0,
      details: null,
      jobName: 'Calculate',
      descriptiveStatus: 'Completed',
    },
    output: 'job',
    body: {
      jobType: 'CUBE_REFRESH',
      jobName: 'Calculate',
      parameters: {},
    },
  },
  {
    operation: 'set_administration_mode',
    source: 'pbcs_admin_job.html',
    input: {
      application: 'Vision',
      loginLevel: 'Administrators',
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/jobs',
    response: {
      jobId: 42,
      status: 0,
      details: null,
      jobName: 'Calculate',
      descriptiveStatus: 'Completed',
    },
    output: 'job',
    body: {
      jobType: 'Administration Mode',
      parameters: {
        loginLevel: 'Administrators',
      },
    },
  },
  {
    operation: 'run_data_map',
    input: {
      application: 'Vision',
      jobName: 'Reporting',
      clearData: false,
      overrideMembersMap: {
        Period: 'ILvl0Descendants(Q1)',
      },
      overrideExclusionMembersMap: {
        Period: 'Jan',
      },
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/jobs',
    response: {
      jobId: 42,
      status: -1,
      details: null,
      jobName: 'Reporting',
      descriptiveStatus: 'Processing',
    },
    output: 'job',
    body: {
      jobType: 'PLAN_TYPE_MAP',
      jobName: 'Reporting',
      parameters: {
        clearData: false,
        overrideMembersMap: {
          Period: 'ILvl0Descendants(Q1)',
        },
        overrideExclusionMembersMap: {
          Period: 'Jan',
        },
      },
    },
    source: 'plan_type_map.html',
  },
  {
    operation: 'list_user_variable_values',
    input: {
      application: 'Vision',
      offset: 25,
      limit: 10,
    },
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications/Vision/uservariablevalues',
    response: {
      items: [
        {
          userName: 'planner',
          name: 'CurrentEntity',
          dimension: 'Entity',
          member: 'Marketing',
        },
      ],
    },
    output: 'userVariableValues',
    query: {
      offset: '25',
      limit: '10',
    },
    source: 'planning_get_user_variables_for_app.html',
  },
  {
    operation: 'set_user_variable_values',
    input: {
      application: 'Vision',
      userVariableValues: [
        {
          userName: 'planner',
          name: 'CurrentEntity',
          dimension: 'Entity',
          member: 'Marketing',
        },
      ],
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/uservariablevalues',
    response: null,
    output: 'updated',
    body: {
      items: [
        {
          userName: 'planner',
          name: 'CurrentEntity',
          dimension: 'Entity',
          member: 'Marketing',
        },
      ],
    },
    source: 'planning_set_user_variables.html',
  },
  {
    operation: 'list_planning_units',
    input: {
      application: 'Vision',
      scenario: 'Forecast',
      planningVersion: 'Working',
      offset: 5,
      limit: 10,
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/planningunits',
    response: {
      items: [
        {
          name: null,
          value: -1,
          owner: 'planner',
          version: 'Working',
          entity: 'Marketing',
          status: 'Under Review',
          scenario: 'Forecast',
          formattedValue: '',
          puName: 'Marketing',
          subStatus: '',
          secMember: null,
          puAlias: 'Marketing',
          scenarioAlias: null,
          versionAlias: null,
          puId: 50410,
        },
      ],
    },
    output: 'planningUnits',
    form: {},
    query: {
      q: '{"scenario":"Forecast","version":"Working"}',
      offset: '5',
      limit: '10',
    },
    source: 'list_all_planning_units.html',
  },
  {
    operation: 'get_planning_unit_actions',
    input: {
      application: 'Vision',
      puhIdentifier: 'Forecast::"Working"',
      pmMembers: '"Sales & Services: Retail",Marketing',
      approvalOptions: 0,
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/planningunits/Forecast%3A%3A%22Working%22/availableactions',
    response: {
      items: [
        {
          actionId: 6,
          name: 'Promote',
        },
      ],
    },
    output: 'planningUnitActions',
    form: {
      pmMembers: '"Sales & Services: Retail",Marketing',
    },
    query: {
      q: '{"options":0}',
    },
    source: 'get_available_planning_unit_actions.html',
  },
  {
    operation: 'get_planning_unit_history',
    input: {
      application: 'Vision',
      puIdentifier: 'Forecast::"Working"::Marketing::',
      annotSeq: 1,
      logSeq: -1,
      offset: 0,
      limit: 10,
    },
    method: 'GET',
    path: '/HyperionPlanning/rest/v3/applications/Vision/planningunits/Forecast%3A%3A%22Working%22%3A%3AMarketing%3A%3A/historyandannotations',
    response: {
      items: [
        {
          comment: 'Review note',
          hasHistory: false,
          logSeq: -1,
          staticImage: true,
          authorImagePath: '/Images/GhostUser.png',
          commentTitle: 'planner',
          commentDate: '8/22/14 3:41 PM',
          commentSubTitle: '',
          parentAnntSeq: 1,
          isChildNode: false,
        },
      ],
    },
    output: 'planningUnitHistory',
    query: {
      q: '{"annotSeq":1,"logSeq":-1}',
      offset: '0',
      limit: '10',
    },
    source: 'get_planning_unit_history_and_annotations.html',
  },
  {
    operation: 'change_planning_unit_status',
    input: {
      application: 'Vision',
      puhIdentifier: 'Forecast::"Working"',
      pmMembers: 'Marketing',
      actionId: 6,
      comments: 'Ready & reviewed + approved',
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/planningunits/Forecast%3A%3A%22Working%22/actions',
    response: {
      links: [
        {
          rel: 'self',
          href: 'https://epm.example.com/HyperionPlanning/rest/v3/applications/Vision/planningunits/Forecast%3A%3A%22Working%22/actions',
          action: 'POST',
          data: {
            pmMembers: '"Marketing"',
            action: 'PROMOTE',
            comments: '"Ready & reviewed + approved"',
          },
        },
      ],
    },
    output: 'planningUnitAction',
    form: {
      actionId: '6',
      pmMembers: 'Marketing',
      comments: 'Ready & reviewed + approved',
    },
    source: 'change_planning_unit_status.html',
  },
  {
    operation: 'get_insights',
    input: {
      application: 'Vision',
      cube: 'Plan1',
      insightSlice: {
        pov: {
          members: ['Sales'],
          dimensions: ['Account'],
        },
        columnAxisDefinition: {
          dimensions: ['Period'],
          segments: [[['Jan', 'Feb']]],
        },
        rowAxisDefinition: {
          dimensions: ['Scenario'],
          segments: [[['Forecast']]],
        },
      },
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/insights',
    response: {
      items: [
        {
          id: 426,
          type: 'HISTORICAL_INSIGHTS',
          accountName: 'Sales',
          outlierValue: 0,
          actualImpactValue: 12079.16,
          percentImpact: '32.40%',
        },
      ],
      totalResults: 2,
      hasMore: true,
    },
    output: 'insights',
    body: {
      dataSourceType: 'CUBE',
      location: 'Plan1',
      slice: {
        pov: {
          members: ['Sales'],
          dimensions: ['Account'],
        },
        columnAxisDefinition: {
          dimensions: ['Period'],
          segments: [[['Jan', 'Feb']]],
        },
        rowAxisDefinition: {
          dimensions: ['Scenario'],
          segments: [[['Forecast']]],
        },
      },
      retrievalMode: 'USE_EXISTING',
    },
    source: 'get_insigh.html',
  },
  {
    operation: 'summarize_insights',
    input: {
      application: 'Vision',
      summaryInputMode: 'ids',
      insightIds: ['426'],
    },
    method: 'POST',
    path: '/HyperionPlanning/rest/v3/applications/Vision/insights/summary',
    response: {
      summary: 'Forecast variance requires review.',
    },
    output: 'summary',
    body: {
      format: 'text',
      size: 100,
      ids: ['426'],
    },
    source: 'insigh_summ.html',
  },
]

async function invoke(operation: string, input: Record<string, unknown>, signal?: AbortSignal) {
  const response = await executeOracleEpmPlanningTool({
    toolId: `oracle_epm_planning_${operation}`,
    input: { ...AUTH, ...input },
    headers: new Headers(),
    context: { userId: 'user-1', workflowId: 'workflow-1' },
    requestId: 'request-1',
    signal,
  })
  return { status: response.status, result: (await response.json()) as OracleEpmPlanningResponse }
}
function respond(data: unknown, status = 200) {
  mocks.fetch.mockImplementation(
    async () =>
      new Response(status === 204 ? null : JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      })
  )
}

describe('Planning operation contracts through the real foundation', () => {
  it('accepts numeric job references through the dispatcher', async () => {
    respond({
      jobId: 42,
      status: 0,
      details: null,
      jobName: 'Calculate',
      descriptiveStatus: 'Completed',
    })
    expect(
      (await invoke('wait_for_job', { application: 'Vision', jobId: 42 })).result.success
    ).toBe(true)
    expect(new URL(mocks.fetch.mock.calls[0][0]).pathname).toBe(
      '/HyperionPlanning/rest/v3/applications/Vision/jobs/42'
    )
  })
  it('normalizes documented action links and rejects conflicting methods', () => {
    const status = {
      status: -1,
      details: null,
      links: [
        {
          rel: 'Job Status',
          action: 'GET',
          href: 'https://epm.example.com/interop/rest/v1/services/jobs/42',
        },
      ],
    }
    expect(interopStatusSchema.parse(status).links[0].method).toBe('GET')
    expect(
      interopStatusSchema.safeParse({ ...status, links: [{ ...status.links[0], method: 'POST' }] })
        .success
    ).toBe(false)
  })
  it('accepts a member without the documented availability-dependent dataType', () => {
    const member = {
      name: 'Sales',
      description: null,
      parentName: 'Account',
      dimName: 'Account',
      dataType: 'UNSPECIFIED',
      dataStorage: 'STOREDATA',
      objectType: 33,
      twoPass: false,
    }
    const { dataType: _dataType, ...withoutType } = member
    expect(memberSchema.parse(withoutType)).toEqual(withoutType)
    expect(memberSchema.safeParse({ ...withoutType, dataType: null }).success).toBe(false)
  })
  it('bounds wide arrays, oversized strings and cycles before serialization', () => {
    expect(() => assertPlanningPayload(Array(1_000_001).fill(0))).toThrow()
    expect(() => assertPlanningPayload('x'.repeat(16 * 1024 * 1024))).toThrow()
    const cyclic: { child?: unknown } = {}
    cyclic.child = cyclic
    expect(() => assertPlanningPayload(cyclic)).toThrow()
    const value = { text: 'quote" and unicode λ', values: [true, null, 123, 'line\n'] }
    expect(assertPlanningPayload(value)).toBe(Buffer.byteLength(JSON.stringify(value)))
  })
  /**
   * Cube variable contracts:
   * https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_get_subst_variables_defined_at_plan_type_level_5.html
   * https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_get_derived_subst_variables_at_plan_type_level_6.html
   * https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_get_a_subst_variables_defined_at_plan_type_level_7.html
   * https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_get_derived_subst_variables_defined_at_plan_type_level_8.html
   * https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_del_a_subst_variable_for_plantype.html
   */
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validate.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
  })
  it.each(CASES)('$operation matches its official method, encoding and output', async (entry) => {
    expect(entry.source).toMatch(/\.html$/)
    respond(entry.response, entry.response === null ? 204 : 200)
    const { result, status } = await invoke(entry.operation, entry.input)
    expect(status).toBe(200)
    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(result.output).toHaveProperty(entry.output)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const [url, , options] = mocks.fetch.mock.calls[0]
    expect(new URL(url).pathname).toBe(entry.path)
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual(entry.query ?? {})
    expect(options.method).toBe(entry.method)
    if (entry.body !== undefined) expect(JSON.parse(options.body)).toEqual(entry.body)
    else if (entry.form !== undefined) {
      expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      const encoded = new TextDecoder().decode(options.body)
      expect(Object.fromEntries(new URLSearchParams(encoded))).toEqual(entry.form)
    } else expect(options.body).toBeUndefined()
  })
  it('requires explicit data-map clearing without widening generic job parameters', async () => {
    for (const [operation, input] of [
      ['run_data_map', { application: 'Vision', jobName: 'Reporting' }],
      [
        'run_data_map',
        {
          application: 'Vision',
          jobName: 'Reporting',
          clearData: false,
          overrideMembersMap: { Period: ['Jan'] },
        },
      ],
      [
        'run_job',
        {
          application: 'Vision',
          jobType: 'PLAN_TYPE_MAP',
          jobName: 'Reporting',
          parameters: { overrideMembersMap: { Period: 'Jan' } },
        },
      ],
    ] as const) {
      expect((await invoke(operation, input)).status).toBe(400)
    }
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it.each([400, 403])(
    'does not hide or replay a user-variable batch error (%i)',
    async (status) => {
      respond({ items: [{ id: 'member', details: 'Invalid selection' }] }, status)
      const entry = CASES.find((item) => item.operation === 'set_user_variable_values')!
      const result = await invoke(entry.operation, entry.input)
      expect(result.status).toBe(status)
      expect(result.result.success).toBe(false)
      expect(result.result.output.updated).toBeUndefined()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    }
  )
  it('accepts only empty 204 as user-variable write confirmation', async () => {
    const entry = CASES.find((item) => item.operation === 'set_user_variable_values')!
    respond(null, 204)
    expect((await invoke(entry.operation, entry.input)).result.output).toEqual({ updated: true })
    respond({ updated: true }, 200)
    expect((await invoke(entry.operation, entry.input)).result.success).toBe(false)
  })
  it('returns empty bounded lists without manufacturing completion flags', async () => {
    for (const operation of [
      'list_user_variable_values',
      'list_planning_units',
      'get_planning_unit_history',
    ]) {
      const entry = CASES.find((item) => item.operation === operation)!
      respond({ items: [] })
      const { result } = await invoke(operation, entry.input)
      expect(result.output).toEqual({ [entry.output]: [] })
      expect((await invoke(operation, { ...entry.input, limit: -1 })).status).toBe(400)
      expect((await invoke(operation, { ...entry.input, limit: 1001 })).status).toBe(400)
    }
  })
  it('rejects malformed user-variable values and oversized batches before requests', async () => {
    for (const userVariableValues of [
      [],
      [{ name: 'CurrentEntity' }],
      Array(1001).fill({
        userName: 'planner',
        name: 'CurrentEntity',
        dimension: 'Entity',
        member: 'Marketing',
      }),
    ]) {
      expect(
        (await invoke('set_user_variable_values', { application: 'Vision', userVariableValues }))
          .status
      ).toBe(400)
    }
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('preserves documented null planning-unit metadata and annotation sequences', async () => {
    const units = CASES.find((item) => item.operation === 'list_planning_units')!
    respond(units.response)
    expect(
      (await invoke(units.operation, units.input)).result.output.planningUnits?.[0]
    ).toMatchObject({
      name: null,
      secMember: null,
      scenarioAlias: null,
      versionAlias: null,
      puId: 50410,
    })
    const history = CASES.find((item) => item.operation === 'get_planning_unit_history')!
    respond(history.response)
    expect(
      (await invoke(history.operation, history.input)).result.output.planningUnitHistory?.[0]
    ).toMatchObject({
      hasHistory: false,
      logSeq: -1,
      parentAnntSeq: 1,
    })
  })
  it('does not confuse approval confirmation with a job or echo unconfirmed input', async () => {
    const entry = CASES.find((item) => item.operation === 'change_planning_unit_status')!
    respond(entry.response)
    expect((await invoke(entry.operation, entry.input)).result.output).toEqual({
      planningUnitAction: {
        pmMembers: '"Marketing"',
        action: 'PROMOTE',
        comments: '"Ready & reviewed + approved"',
      },
    })
    for (const response of [{}, { links: [] }, { jobId: 42, status: 0 }]) {
      respond(response)
      expect((await invoke(entry.operation, entry.input)).result.success).toBe(false)
    }
  })
  it.each([
    [
      'https://other.example.com/HyperionPlanning/rest/v3/applications/Vision/planningunits/Forecast/actions',
      'POST',
    ],
    [
      'https://epm.example.com/HyperionPlanning/rest/v2/applications/Vision/planningunits/Forecast/actions',
      'POST',
    ],
    [
      'https://epm.example.com/HyperionPlanning/rest/v3/applications/Vision/planningunits/Forecast/actions',
      'GET',
    ],
  ])('rejects invalid approval confirmation links without replay: %s %s', async (href, action) => {
    respond({
      links: [
        {
          rel: 'self',
          href,
          action,
          data: { pmMembers: 'Marketing', action: 'PROMOTE', comments: '' },
        },
      ],
    })
    const entry = CASES.find((item) => item.operation === 'change_planning_unit_status')!
    expect((await invoke(entry.operation, entry.input)).result.success).toBe(false)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('normalizes insight IDs for summaries while preserving incomplete-result information', async () => {
    const entry = CASES.find((item) => item.operation === 'get_insights')!
    respond(entry.response)
    const { result } = await invoke(entry.operation, entry.input)
    expect(result.output).toMatchObject({
      insights: [{ id: '426', outlierValue: 0 }],
      totalResults: 2,
      hasMore: true,
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    respond({ items: [], totalResults: 0, hasMore: false })
    expect((await invoke(entry.operation, entry.input)).result.output).toEqual({
      insights: [],
      totalResults: 0,
      hasMore: false,
    })
    respond({ items: [], totalResults: 0 })
    expect((await invoke(entry.operation, entry.input)).result.success).toBe(false)
  })
  it('requires the distinct insight slice and an explicit calendar for recomputation', async () => {
    const entry = CASES.find((item) => item.operation === 'get_insights')!
    expect(
      (await invoke(entry.operation, { ...entry.input, retrievalMode: 'FORCE_RECOMPUTE' })).status
    ).toBe(400)
    expect(
      (
        await invoke(entry.operation, {
          ...entry.input,
          insightSlice: { pov: [], columns: [], rows: [] },
        })
      ).status
    ).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
    respond(entry.response)
    await invoke(entry.operation, {
      ...entry.input,
      retrievalMode: 'FORCE_RECOMPUTE',
      calendar: 'Fiscal',
    })
    expect(JSON.parse(mocks.fetch.mock.calls[0][2].body)).toMatchObject({
      retrievalMode: 'FORCE_RECOMPUTE',
      calendar: 'Fiscal',
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('sends only the selected summary mode and always requests text', async () => {
    const get = CASES.find((item) => item.operation === 'get_insights')!
    respond({ summary: 'Variance summary', warnings: [], resolvedNarrative: { ignored: true } })
    const ids = await invoke('summarize_insights', {
      ...get.input,
      summaryInputMode: 'ids',
      insightIds: ['426'],
      retrievalMode: 'FORCE_RECOMPUTE',
      calendar: 'Stale',
      summarySize: 80,
    })
    expect(ids.result.output).toEqual({ summary: 'Variance summary' })
    expect(JSON.parse(mocks.fetch.mock.calls[0][2].body)).toEqual({
      ids: ['426'],
      format: 'text',
      size: 80,
    })
    await invoke('summarize_insights', {
      ...get.input,
      summaryInputMode: 'slice',
      insightIds: ['999'],
    })
    expect(JSON.parse(mocks.fetch.mock.calls[1][2].body)).toEqual({
      dataSourceType: 'CUBE',
      location: 'Plan1',
      slice: get.input.insightSlice,
      retrievalMode: 'USE_EXISTING',
      format: 'text',
      size: 100,
    })
  })
  it('rejects incomplete summary inputs and undocumented JSON summaries', async () => {
    for (const input of [
      { summaryInputMode: 'ids' },
      { summaryInputMode: 'ids', insightIds: [426] },
      { summaryInputMode: 'slice', cube: 'Plan1' },
      { summaryInputMode: 'slice', insightSlice: {} },
      { summaryInputMode: 'unknown', insightIds: ['426'] },
    ])
      expect((await invoke('summarize_insights', { application: 'Vision', ...input })).status).toBe(
        400
      )
    expect(mocks.fetch).not.toHaveBeenCalled()
    respond({ summary: { text: 'Not a documented text result' } })
    expect(
      (
        await invoke('summarize_insights', {
          application: 'Vision',
          summaryInputMode: 'ids',
          insightIds: ['426'],
        })
      ).result.success
    ).toBe(false)
  })
  it('rejects oversized insight summaries clearly instead of truncating them', async () => {
    respond({ summary: 'x'.repeat(16 * 1024 * 1024) })
    const result = await invoke('summarize_insights', {
      application: 'Vision',
      summaryInputMode: 'ids',
      insightIds: ['426'],
    })
    expect(result.status).toBe(413)
    expect(result.result.success).toBe(false)
    expect(result.result.output.summary).toBeUndefined()
  })
  it('normalizes only documented job and boolean variants', async () => {
    const job = {
      jobId: 42,
      status: 0,
      details: null,
      jobName: 'Calculate',
      descriptiveStatus: 'Completed',
    }
    expect(jobSchema.parse({ ...job, jobId: undefined, jobID: 42 })).toEqual(job)
    expect(
      jobSchema.parse({ ...job, descriptiveStatus: undefined, jobStatus: 'Completed' })
    ).toEqual(job)
    expect(jobSchema.safeParse({ ...job, jobID: 99 }).success).toBe(false)
    expect(jobSchema.safeParse({ ...job, jobId: undefined }).success).toBe(false)
    expect(jobSchema.safeParse({ ...job, details: {} }).success).toBe(false)
    respond({ items: [{ name: 'Vision', adminMode: 'false', hybrid: 'true' }] })
    const { result } = await invoke('list_applications', {})
    expect(result.output.applications).toEqual([{ name: 'Vision', adminMode: false, hybrid: true }])
  })
  it('keeps cube-scoped variable inheritance and message filters in q JSON', async () => {
    respond({ items: [] })
    await invoke('list_substitution_variables', {
      application: 'Vision',
      cube: 'Plan1',
      derivedValues: true,
    })
    expect(new URL(mocks.fetch.mock.calls[0][0]).searchParams.get('q')).toBe(
      '{"derivedValues":true}'
    )
    await invoke('get_job_details', {
      application: 'Vision',
      jobId: '42',
      messageType: 'ERROR',
      limit: 25,
    })
    expect(new URL(mocks.fetch.mock.calls[1][0]).searchParams.get('q')).toBe(
      '{"messageType":"ERROR"}'
    )
  })
  it('reports partial imports without hiding rejection counts or reasons', async () => {
    const diagnostics = {
      numAcceptedCells: 8,
      numUpdateCells: 8,
      numRejectedCells: 4,
      rejectedCells: ['[Plan,Sales]'],
      rejectedCellsWithDetails: [
        {
          memberNames: ['Plan', 'Sales'],
          readOnlyReasons: ['Invalid Intersection'],
          otherReasons: [],
        },
      ],
    }
    respond(diagnostics)
    const { result } = await invoke('import_data_slice', {
      application: 'Vision',
      cube: 'Plan1',
      dataGrid: {
        pov: ['FY26'],
        columns: [['Jan']],
        rows: [{ headers: ['Sales'], data: ['120'] }],
      },
    })
    expect(result.success).toBe(true)
    expect(result.output.importResult).toEqual(diagnostics)
  })
  it('does not confuse form maps/numeric rows with data-slice axes', () => {
    expect(
      formDataSchema.safeParse({
        pov: ['FY26'],
        columns: [['Jan']],
        rows: [{ headers: ['Sales'], data: ['120'] }],
      }).success
    ).toBe(false)
    expect(
      formDataSchema.safeParse({
        gridInfo: {
          pageDimNames: ['Scenario'],
          allowedPageMembersByDim: { Scenario: ['Plan'] },
          rowDimNames: ['Account'],
          columnDimNames: ['Period'],
        },
        pov: { Scenario: 'Plan' },
        columns: [['Jan']],
        rows: [{ headers: ['Sales'], data: [120] }],
      }).success
    ).toBe(true)
    expect(
      dimensionSchema.safeParse({ name: 'Account', children: [{ name: 'Sales' }] }).success
    ).toBe(true)
    expect(
      memberSchema.parse({
        ...{
          name: 'Sales',
          description: null,
          parentName: 'Account',
          dimName: 'Account',
          dataType: 'UNSPECIFIED',
          dataStorage: 'STOREDATA',
          objectType: 33,
          twoPass: false,
        },
        children: null,
      })
    ).not.toHaveProperty('children')
  })
  it.each([null, {}, { items: null }, { items: [{}] }, { items: 'not-an-array' }])(
    'rejects malformed application response %j',
    async (data) => {
      respond(data)
      const { status, result } = await invoke('list_applications', {})
      expect(status).toBe(502)
      expect(result.success).toBe(false)
    }
  )
  it('accepts empty lists, but not wrong success statuses for 204 mutations', async () => {
    respond({ items: [] })
    expect((await invoke('list_applications', {})).result.output.applications).toEqual([])
    respond({})
    const result = await invoke('set_substitution_variables', {
      application: 'Vision',
      variables: [{ name: 'Year', value: 'FY26', planType: 'ALL' }],
    })
    expect(result.result.success).toBe(false)
  })
  it('rejects invalid inputs, huge payloads and unknown tools before networking', async () => {
    for (const [operation, input] of [
      ['list_dimensions', { application: 'Vision', cube: 'Plan1', limit: -1 }],
      ['run_rule', { application: 'Vision', jobName: 'Calc', parameters: { prompt: 5 } }],
      ['export_application_data', { application: 'Vision' }],
      ['no_such_tool', {}],
    ] as const)
      expect((await invoke(operation, input)).result.success).toBe(false)
    expect(
      (await invoke('list_applications', { padding: 'x'.repeat(16 * 1024 * 1024) })).status
    ).toBe(413)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('does not replay a rejected mutation or expose its provider error body', async () => {
    respond({ error: 'private-response-canary' }, 503)
    const { result } = await invoke('run_job', {
      application: 'Vision',
      jobType: 'RULES',
      jobName: 'Calc',
    })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).not.toContain('private-response-canary')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('propagates cancellation before work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Stopped', 'AbortError'))
    await expect(invoke('list_applications', {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('bounds recursive provider hierarchies before recursive parsing', () => {
    let value: unknown = { name: 'Leaf' }
    for (let i = 0; i < 70; i++) value = { name: 'Parent', children: [value] }
    expect(() => parsePlanningResponse(dimensionSchema, { status: 200, data: value })).toThrow()
  })
})
