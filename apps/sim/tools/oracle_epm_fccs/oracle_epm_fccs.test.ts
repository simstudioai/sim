/** @vitest-environment node */
import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => ({ open: vi.fn(), store: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: files.open,
  storeOracleEpmDownload: files.store,
}))

import { executeOracleEpmFccsTool } from '@/lib/internal/oracle-epm-fccs/execute-tool'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { OracleEpmFccsBlock } from '@/blocks/blocks/oracle_epm_fccs'
import * as definitions from '@/tools/oracle_epm_fccs'
import type { InternalToolConfig } from '@/tools/types'

const AUTH = {
  instanceUrl: 'https://epm.example.com/gateway',
  accessToken: Buffer.from('user:password').toString('base64'),
}
const tools = Object.values(definitions) as InternalToolConfig<Record<string, unknown>>[]
interface Contract {
  id: string
  input: Record<string, unknown>
  path: string
  method: string
  response: unknown
  body?: unknown
  query?: Record<string, string | number>
  expected: unknown
  preflight?: unknown
  source: string
}
/** Oracle examples/field tables; NetSuite's wire-contract matrix is the structural precedent. */
const contracts: Contract[] = [
  {
    id: 'list_applications',
    input: {},
    path: '/HyperionPlanning/rest/v3/applications',
    method: 'GET',
    response: {
      items: [
        {
          name: 'Close',
          type: 'HP',
          appType: 'FCCS',
          appStorage: 'Multidim',
        },
      ],
    },
    expected: {
      items: [
        {
          name: 'Close',
          type: 'HP',
          appType: 'FCCS',
          appStorage: 'Multidim',
        },
      ],
    },
    source: 'get_applications',
  },
  {
    id: 'list_cubes',
    input: {
      application: 'Close',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/plantypes',
    method: 'GET',
    response: {
      items: [
        {
          planTypeName: 'Consol',
          cubeName: 'Consol',
          planType: 1,
          numDimensions: 13,
          cubeType: 0,
        },
      ],
    },
    expected: {
      items: [
        {
          planTypeName: 'Consol',
          cubeName: 'Consol',
          planType: 1,
          numDimensions: 13,
          cubeType: 0,
        },
      ],
    },
    source: 'get_plan_types',
  },
  {
    id: 'list_dimensions',
    input: {
      application: 'Close',
      cube: 'Consol',
      offset: 2,
      limit: 3,
      filter: {
        dimType: 'Entity',
      },
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/plantypes/Consol/dimensions',
    method: 'GET',
    response: {
      items: [
        {
          id: 'id',
          name: 'Entity',
          dimType: 'Entity',
          objectType: 'Dimension',
          level: 4,
        },
      ],
      totalResults: 4,
      hasMore: true,
    },
    query: {
      offset: 2,
      limit: 3,
      q: '{"dimType":"Entity"}',
    },
    expected: {
      items: [
        {
          id: 'id',
          name: 'Entity',
          dimType: 'Entity',
          objectType: 'Dimension',
          level: 4,
        },
      ],
      totalResults: 4,
      hasMore: true,
    },
    source: 'get_dim_plan_types',
  },
  {
    id: 'get_dimension',
    input: {
      application: 'Close',
      cube: 'Consol',
      dimension: 'Entity',
      aliasTableName: 'Default',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/plantypes/Consol/dimensions/Entity',
    method: 'GET',
    response: {
      name: 'Entity',
      id: 'root',
      children: [
        {
          name: 'North & West',
          path: '/Entity/North & West',
          alias: 'Northwest',
        },
      ],
    },
    query: {
      fields: 'id,name,path,alias,children',
      aliasTableName: 'Default',
    },
    expected: {
      name: 'Entity',
      id: 'root',
      children: [
        {
          name: 'North & West',
          path: '/Entity/North & West',
          alias: 'Northwest',
        },
      ],
    },
    source: 'get_dim_details',
  },
  {
    id: 'get_member',
    input: {
      application: 'Close',
      dimension: 'Entity',
      member: 'North & West',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/dimensions/Entity/members/North%20%26%20West',
    method: 'GET',
    response: {
      name: 'North & West',
      parentName: 'Total Entity',
      dataStorage: 'STOREDATA',
      objectType: 33,
      twoPass: false,
    },
    expected: {
      name: 'North & West',
      parentName: 'Total Entity',
      dataStorage: 'STOREDATA',
      objectType: 33,
      twoPass: false,
    },
    source: 'get_member',
  },
  {
    id: 'add_member',
    input: {
      application: 'Close',
      dimension: 'Entity',
      member: 'North & West',
      parentName: 'Total Entity',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/dimensions/Entity/members',
    method: 'POST',
    response: {
      name: 'North & West',
      parentName: 'Total Entity',
      dataStorage: 'STOREDATA',
      objectType: 33,
      twoPass: false,
    },
    body: {
      memberName: 'North & West',
      parentName: 'Total Entity',
    },
    expected: {
      name: 'North & West',
      parentName: 'Total Entity',
      dataStorage: 'STOREDATA',
      objectType: 33,
      twoPass: false,
    },
    source: 'add_member',
  },
  {
    id: 'validate_metadata',
    input: {
      application: 'Close',
      logFileName: 'validate report',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/application/validatemetadata',
    method: 'POST',
    response: {
      numWarnings: 1,
      numInfo: 2,
      numErrors: 0,
      outPutFileName: 'validate report.csv',
      status: 'Validate Metadata Completed',
    },
    query: {
      logFileName: 'validate report',
    },
    expected: {
      numWarnings: 1,
      numInfo: 2,
      numErrors: 0,
      outPutFileName: 'validate report.csv',
      status: 'Validate Metadata Completed',
    },
    source: 'fccs_validate_metadata',
  },
  {
    id: 'list_job_definitions',
    input: {
      application: 'Close',
      jobType: 'RULES',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobdefinitions',
    method: 'GET',
    response: {
      items: [
        {
          jobType: 'RULES',
          jobName: 'Consolidate',
        },
      ],
    },
    query: {
      q: '{"jobType":"RULES"}',
    },
    expected: {
      items: [
        {
          jobType: 'RULES',
          jobName: 'Consolidate',
        },
      ],
    },
    source: 'get_job_definitions',
  },
  {
    id: 'execute_job',
    input: {
      application: 'Close',
      jobType: 'IMPORT_DATA',
      jobName: 'Load',
      parameters: {
        importFileName: 'month end.csv',
      },
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'IMPORT_DATA',
      jobName: 'Load',
      parameters: {
        importFileName: 'month end.csv',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'execute_a_job',
  },
  {
    id: 'run_rule',
    input: {
      application: 'Close',
      rule: 'Custom adjustment',
      parameters: {
        'My RTP': 'North & West',
        rate: 1.25,
      },
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'RULES',
      jobName: 'Custom adjustment',
      parameters: {
        'My RTP': 'North & West',
        rate: 1.25,
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'rules',
  },
  {
    id: 'run_ruleset',
    input: {
      application: 'Close',
      ruleset: 'Close books',
      parameters: {
        'Rule.Entity': 'North',
      },
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'RULESET',
      jobName: 'Close books',
      parameters: {
        'Rule.Entity': 'North',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'ruleset',
  },
  {
    id: 'run_consolidation',
    input: {
      application: 'Close',
      scenario: 'Actual',
      year: 'FY26',
      period: 'Jan',
      entity: 'North',
      force: true,
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'RULES',
      jobName: 'ForceConsolidate',
      parameters: {
        Entity: 'North',
        Period: 'Jan',
        Scenario: 'Actual',
        Year: 'FY26',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'rules',
  },
  {
    id: 'run_translation',
    input: {
      application: 'Close',
      scenario: 'Actual',
      year: 'FY26',
      period: 'Jan',
      entity: 'North',
      force: false,
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'RULES',
      jobName: 'Translate',
      parameters: {
        Entity: 'North',
        Period: 'Jan',
        Scenario: 'Actual',
        Year: 'FY26',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'rules',
  },
  {
    id: 'get_job',
    input: {
      application: 'Close',
      jobId: '42',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs/42',
    method: 'GET',
    response: {
      jobId: 42,
      status: 0,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    expected: {
      jobId: '42',
      status: 0,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'retrieve_job_status',
  },
  {
    id: 'wait_for_job',
    input: {
      application: 'Close',
      jobId: '42',
      maxWaitSeconds: 5,
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs/42',
    method: 'GET',
    response: {
      jobId: 42,
      status: 0,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    expected: {
      jobId: '42',
      status: 0,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
      attempts: 1,
    },
    source: 'retrieve_job_status',
  },
  {
    id: 'get_job_details',
    input: {
      application: 'Close',
      jobId: '42',
      detailJobType: 'IMPORT_METADATA',
      offset: 0,
      limit: 10,
      messageType: 'ERROR',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs/42/details',
    method: 'GET',
    response: {
      items: [
        {
          recordsRead: 8,
          recordsRejected: 0,
          recordsProcessed: 8,
          dimensionName: 'Entity',
          loadType: 'Metadata Import',
        },
      ],
    },
    query: {
      offset: 0,
      limit: 10,
      q: '{"messageType":"ERROR"}',
    },
    expected: {
      items: [
        {
          recordsRead: 8,
          recordsRejected: 0,
          recordsProcessed: 8,
          dimensionName: 'Entity',
          loadType: 'Metadata Import',
        },
      ],
      hasMore: false,
    },
    source: 'retrieve_job_status_details',
  },
  {
    id: 'get_child_job_details',
    input: {
      application: 'Close',
      jobId: '42',
      childJobId: '3',
      childJobType: 'IMPORT_METADATA',
      limit: 10,
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs/42/childjobs/3/details',
    method: 'GET',
    response: {
      items: [
        {
          msgType: 'INFO',
          msgCategory: 'Load',
          msgText: 'Loaded',
        },
      ],
    },
    query: {
      offset: 0,
      limit: 10,
    },
    expected: {
      items: [
        {
          msgType: 'INFO',
          msgCategory: 'Load',
          msgText: 'Loaded',
        },
      ],
      hasMore: false,
    },
    source: 'retrieve_child_job_status_details',
  },
  {
    id: 'export_job_console',
    input: {
      application: 'Close',
      parameters: {
        fileName: 'console.csv',
        ndays: '7',
        jobStatusCodes: 'all',
      },
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'JOBCONSOLE_EXPORT',
      parameters: {
        fileName: 'console.csv',
        ndays: '7',
        jobStatusCodes: 'all',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'pbcs_export_job_console_job',
  },
  {
    id: 'export_data_slice',
    input: {
      application: 'Close',
      cube: 'Consol',
      gridDefinition: {
        pov: {
          members: [['Actual']],
        },
        columns: [
          {
            members: [['Jan']],
          },
        ],
        rows: [
          {
            members: [['Revenue']],
          },
        ],
      },
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/plantypes/Consol/exportdataslice',
    method: 'POST',
    response: {
      pov: ['Actual'],
      columns: [['Jan']],
      rows: [
        {
          headers: ['Revenue'],
          data: [123],
        },
      ],
    },
    body: {
      exportPlanningData: false,
      gridDefinition: {
        pov: {
          members: [['Actual']],
        },
        columns: [
          {
            members: [['Jan']],
          },
        ],
        rows: [
          {
            members: [['Revenue']],
          },
        ],
      },
    },
    expected: {
      pov: ['Actual'],
      columns: [['Jan']],
      rows: [
        {
          headers: ['Revenue'],
          data: [123],
        },
      ],
    },
    source: 'export_dataslices',
  },
  {
    id: 'import_data_slice',
    input: {
      application: 'Close',
      cube: 'Consol',
      dataGrid: {
        pov: ['Actual'],
        columns: [['Jan']],
        rows: [
          {
            headers: ['Revenue'],
            data: [123],
          },
        ],
      },
      aggregateEssbaseData: true,
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/plantypes/Consol/importdataslice',
    method: 'POST',
    response: {
      numAcceptedCells: 1,
      numUpdateCells: 1,
      numRejectedCells: 0,
      rejectedCells: [],
      rejectedCellsWithDetails: [],
    },
    body: {
      dataGrid: {
        pov: ['Actual'],
        columns: [['Jan']],
        rows: [
          {
            headers: ['Revenue'],
            data: [123],
          },
        ],
      },
      aggregateEssbaseData: true,
      cellNotesOption: 'Skip',
      customParams: {
        IncludeRejectedCells: true,
        IncludeRejectedCellsWithDetails: true,
      },
    },
    expected: {
      numAcceptedCells: 1,
      numUpdateCells: 1,
      numRejectedCells: 0,
      rejectedCells: [],
      rejectedCellsWithDetails: [],
    },
    source: 'import_dataslices',
  },
  {
    id: 'clear_data_slice',
    input: {
      application: 'Close',
      cube: 'Consol',
      gridDefinition: {
        pov: {
          members: [['Actual']],
        },
        columns: [
          {
            members: [['Jan']],
          },
        ],
        rows: [
          {
            members: [['Revenue']],
          },
        ],
      },
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/plantypes/Consol/cleardataslice',
    method: 'POST',
    response: {
      numClearedCells: 1,
      numRejectedCells: 0,
      rejectedCells: [],
    },
    body: {
      clearEssbaseData: true,
      clearPlanningData: false,
      gridDefinition: {
        pov: {
          members: [['Actual']],
        },
        columns: [
          {
            members: [['Jan']],
          },
        ],
        rows: [
          {
            members: [['Revenue']],
          },
        ],
      },
    },
    expected: {
      numClearedCells: 1,
      numRejectedCells: 0,
      rejectedCells: [],
    },
    source: 'clear_dataslices',
  },
  {
    id: 'clear_data_profile',
    input: {
      application: 'Close',
      profileName: 'Close clear',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'Clear_Data',
      jobName: 'Execute Profile',
      parameters: {
        ProfileName: 'Close clear',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'fccs_clear_data',
  },
  {
    id: 'copy_data_profile',
    input: {
      application: 'Close',
      profileName: 'Close copy',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'Copy_Data',
      jobName: 'Execute Profile',
      parameters: {
        ProfileName: 'Close copy',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'fccs_copy_data',
  },
  {
    id: 'export_application_data',
    input: {
      application: 'Close',
      jobName: 'Saved job',
      parameters: {
        exportFileName: 'balances.zip',
      },
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'EXPORT_DATA',
      jobName: 'Saved job',
      parameters: {
        exportFileName: 'balances.zip',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'export_data',
  },
  {
    id: 'import_application_data',
    input: {
      application: 'Close',
      jobName: 'Saved job',
      parameters: {
        importFileName: 'balances.zip',
      },
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'IMPORT_DATA',
      jobName: 'Saved job',
      parameters: {
        importFileName: 'balances.zip',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'import_data',
  },
  {
    id: 'import_exchange_rates',
    input: {
      application: 'Close',
      jobName: 'Saved job',
      parameters: {
        importFileName: 'rates.csv',
        includeMetaData: false,
      },
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'IMPORT_EXCHANGE_RATES',
      jobName: 'Saved job',
      parameters: {
        importFileName: 'rates.csv',
        includeMetaData: false,
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'pbcs_import_exchange_rates',
  },
  {
    id: 'export_metadata',
    input: {
      application: 'Close',
      jobName: 'Saved job',
      parameters: {
        exportZipFileName: 'metadata.zip',
      },
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'EXPORT_METADATA',
      jobName: 'Saved job',
      parameters: {
        exportZipFileName: 'metadata.zip',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'export_metadata',
  },
  {
    id: 'import_metadata',
    input: {
      application: 'Close',
      jobName: 'Saved job',
      parameters: {
        importZipFileName: 'metadata.zip',
        refreshCube: false,
        errorFile: 'errors.zip',
      },
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'IMPORT_METADATA',
      jobName: 'Saved job',
      parameters: {
        importZipFileName: 'metadata.zip',
        refreshCube: false,
        errorFile: 'errors.zip',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'import_metadata',
  },
  {
    id: 'list_journals',
    input: {
      application: 'Close',
      scenario: 'Actual',
      year: 'FY26',
      period: 'Jan',
      journalStatus: 'WORKING',
      limit: 5,
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/journals',
    method: 'GET',
    response: {
      totalResults: 1,
      hasMore: false,
      count: 1,
      limit: 5,
      offset: 0,
      items: [
        {
          label: 'Adjustment',
          scenario: 'Actual',
          year: 'FY26',
          period: 'Jan',
          status: 'Working',
          postedBy: null,
          createdOn: '2026-01-31 06:22:47.516',
        },
      ],
    },
    query: {
      q: '{"scenario":"Actual","year":"FY26","period":"Jan","status":"WORKING"}',
      offset: 0,
      limit: 5,
    },
    expected: {
      totalResults: 1,
      hasMore: false,
      count: 1,
      limit: 5,
      offset: 0,
      items: [
        {
          label: 'Adjustment',
          scenario: 'Actual',
          year: 'FY26',
          period: 'Jan',
          status: 'Working',
          postedBy: null,
          createdOn: '2026-01-31 06:22:47.516',
        },
      ],
    },
    source: 'fccs_retrieve_journals',
  },
  {
    id: 'perform_journal_action',
    input: {
      application: 'Close',
      scenario: 'Actual',
      year: 'FY26',
      period: 'Jan',
      journalLabel: 'Adjustment',
      journalAction: 'SUBMIT',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/journals/Adjustment/actions',
    method: 'POST',
    response: {
      actionStatus: 0,
      actionDetail: 'Submitted',
    },
    body: {
      parameters: {
        scenario: 'Actual',
        year: 'FY26',
        period: 'Jan',
        action: 'SUBMIT',
      },
    },
    expected: {
      actionStatus: 0,
      actionDetail: 'Submitted',
    },
    source: 'fccs_perform_journal_actions',
  },
  {
    id: 'update_journal_period',
    input: {
      application: 'Close',
      scenario: 'Actual',
      year: 'FY26',
      period: 'Jan',
      periodAction: 'OPEN',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/journalPeriods/Jan/actions',
    method: 'POST',
    response: {
      actionStatus: 0,
      actionDetail: 'Open',
    },
    body: {
      parameters: {
        scenario: 'Actual',
        year: 'FY26',
        action: 'OPEN',
      },
    },
    expected: {
      scenario: 'Actual',
      year: 'FY26',
      period: 'Jan',
      action: 'OPEN',
      actionStatus: 0,
      actionDetail: 'Open',
    },
    source: 'fccs_perform_journal_update',
  },
  {
    id: 'export_journals',
    input: {
      application: 'Close',
      fileName: 'journal export',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'EXPORT_JOURNAL',
      jobName: 'Export Journal',
      parameters: {
        fileName: 'journal export',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'fccs_export_consolidation_journals',
  },
  {
    id: 'import_journals',
    input: {
      application: 'Close',
      jobName: 'Journal load',
      fileName: 'journals.jlf',
      errorFileName: 'errors.log',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'IMPORT_JOURNAL',
      jobName: 'Journal load',
      parameters: {
        fileName: 'journals.jlf',
        errorFileName: 'errors.log',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'fccs_import_consolidation_journals',
  },
  {
    id: 'generate_intercompany_report',
    input: {
      application: 'Close',
      jobName: 'IC balances',
      scenario: 'Actual',
      year: 'FY26',
      period: 'Jan',
      reportFormat: 'HTML',
      fileName: 'ic-report',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/jobs',
    method: 'POST',
    response: {
      jobId: 42,
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    body: {
      jobType: 'GENERATE_INTERCOMPANY_REPORT',
      jobName: 'IC balances',
      parameters: {
        scenario: 'Actual',
        period: 'Jan',
        reportFormat: 'HTML',
        fileName: 'ic-report',
        years: 'FY26',
      },
    },
    expected: {
      jobId: '42',
      status: -1,
      jobName: 'Nightly',
      details: null,
      descriptiveStatus: 'Processing',
    },
    source: 'fccs_generate_ic_report',
  },
  {
    id: 'export_consolidation_rulesets',
    input: {
      application: 'Close',
      rules: ['Custom consolidation'],
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/exportConfigConsolRules',
    method: 'POST',
    response: 'Job is submitted. See the job console for more information.',
    body: {
      rules: ['Custom consolidation'],
    },
    expected: {
      submitted: true,
      message: 'Job is submitted. See the job console for more information.',
    },
    source: 'fccs_export_consol_rules',
  },
  {
    id: 'import_consolidation_rulesets',
    input: {
      application: 'Close',
      fileName: 'inbox/rules.xml',
    },
    path: '/HyperionPlanning/rest/v3/applications/Close/importConfigConsolRules',
    method: 'POST',
    response: 'Job is submitted. See the job console for more information.',
    body: {
      file: 'inbox/rules.xml',
    },
    expected: {
      submitted: true,
      message: 'Job is submitted. See the job console for more information.',
    },
    source: 'fccs_import_consol_rules',
  },
  {
    id: 'list_files',
    input: {},
    path: '/interop/rest/v2/files/list',
    method: 'GET',
    response: {
      status: 0,
      details: null,
      items: [
        {
          name: 'inbox/data.csv',
          type: 'EXTERNAL',
          size: '3',
          lastmodifiedtime: '1234567890',
        },
      ],
    },
    expected: {
      status: 0,
      details: null,
      items: [
        {
          name: 'inbox/data.csv',
          type: 'EXTERNAL',
          size: '3',
          lastmodifiedtime: '1234567890',
        },
      ],
    },
    source: 'list_files_v2',
  },
  {
    id: 'upload_file',
    input: {
      file: {
        id: 'source',
        name: 'source.csv',
        size: 3,
        type: 'text/csv',
        url: '',
        key: 'workspace/key',
        context: 'workspace',
      },
      fileName: 'data.csv',
      directory: 'inbox',
    },
    path: '/interop/rest/11.1.2.3.600/applicationsnapshots/data.csv/contents',
    method: 'POST',
    response: {
      status: 0,
      details: null,
    },
    body: 'abc',
    query: {
      extDirPath: 'inbox',
    },
    expected: {
      status: 0,
      details: null,
      fileName: 'inbox/data.csv',
    },
    source: 'upload',
  },
  {
    id: 'download_file',
    input: {
      fileName: 'inbox/data.csv',
    },
    path: '/interop/rest/11.1.2.3.600/applicationsnapshots/inbox%2Fdata.csv/contents',
    method: 'GET',
    response: 'abc',
    expected: {
      file: {
        id: 'stored',
        name: 'data.csv',
        size: 3,
        type: 'text/csv',
        url: 'https://storage.example/signed',
        key: 'execution/key',
        context: 'execution',
      },
      fileName: 'inbox/data.csv',
    },
    preflight: {
      status: 0,
      details: null,
      items: [
        {
          name: 'inbox/data.csv',
          type: 'EXTERNAL',
          size: '3',
          lastmodifiedtime: '1234567890',
        },
      ],
    },
    source: 'download',
  },
  {
    id: 'delete_file',
    input: {
      fileName: 'inbox/data.csv',
    },
    path: '/interop/rest/v3/files/delete',
    method: 'POST',
    response: {
      status: 0,
      details: null,
    },
    body: {
      fileName: 'inbox/data.csv',
    },
    expected: {
      status: 0,
      details: null,
      fileName: 'inbox/data.csv',
    },
    preflight: {
      status: 0,
      details: null,
      items: [
        {
          name: 'inbox/data.csv',
          type: 'EXTERNAL',
          size: '3',
          lastmodifiedtime: '1234567890',
        },
      ],
    },
    source: 'delete_files_v3',
  },
]

function providerResponse(data: unknown): Response {
  return typeof data === 'string'
    ? new Response(data, {
        headers: { 'content-type': data === 'abc' ? 'text/csv' : 'text/plain' },
      })
    : new Response(JSON.stringify({ ...(data as object), undocumentedCanary: 'must-not-escape' }), {
        headers: { 'content-type': 'application/json' },
      })
}

describe('FCCS block-to-tool action contracts', () => {
  it.each(contracts)(
    '$id exposes and maps its required and optional operation inputs',
    (contract) => {
      const id = `oracle_epm_fccs_${contract.id}`
      const tool = tools.find((candidate) => candidate.id === id)!
      const configuredJobs = [
        'execute_job',
        'export_application_data',
        'import_application_data',
        'import_exchange_rates',
        'export_metadata',
        'import_metadata',
      ]
      const repositoryActions = [
        'download_file',
        'delete_file',
        'import_consolidation_rulesets',
        'import_journals',
      ]
      const fieldFor = (key: string) => {
        if (contract.id === 'add_member' && key === 'member') return 'newMemberName'
        if (key === 'parentName') return 'parentMember'
        if (key === 'jobName' && !configuredJobs.includes(contract.id)) return 'manualJobName'
        if (key === 'fileName' && repositoryActions.includes(contract.id)) return 'repositoryFile'
        return key
      }
      const values: Record<string, unknown> = { operation: id, oauthCredential: 'chosen' }
      for (const [key, value] of Object.entries(contract.input)) {
        values[fieldFor(key)] =
          key === 'file'
            ? [value]
            : typeof value === 'object'
              ? JSON.stringify(value)
              : typeof value === 'number' || typeof value === 'boolean'
                ? String(value)
                : value
      }
      expect(OracleEpmFccsBlock.tools.config.tool(values)).toBe(id)
      const mapped = OracleEpmFccsBlock.tools.config.params!(values)
      expect(mapped).toMatchObject({ ...contract.input, oauthCredential: 'chosen' })
      for (const [key, param] of Object.entries(tool.params)) {
        if (param.visibility === 'hidden') continue
        const matching = OracleEpmFccsBlock.subBlocks.filter(
          (field) =>
            (field.canonicalParamId ?? field.id) === fieldFor(key) &&
            evaluateSubBlockCondition(field.condition, values)
        )
        expect(matching.length, `${id} missing visible input ${key}`).toBeGreaterThan(0)
        if (param.required)
          expect(
            matching.some(
              (field) =>
                field.required === true ||
                (typeof field.required === 'object' &&
                  evaluateSubBlockCondition(field.required, values))
            ),
            `${id} does not require ${key}`
          ).toBe(true)
      }
    }
  )
})

describe('FCCS documented wire contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    files.open.mockResolvedValue({
      chunks: (async function* () {
        yield Buffer.from('abc')
      })(),
    })
    files.store.mockResolvedValue({
      id: 'stored',
      name: 'data.csv',
      size: 3,
      type: 'text/csv',
      url: 'https://storage.example/signed',
      key: 'execution/key',
      context: 'execution',
    })
  })

  it.each(contracts)(
    '$id sends the documented request and projects only documented output',
    async (contract) => {
      if (contract.preflight)
        inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
          providerResponse(contract.preflight)
        )
      inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
        providerResponse(contract.response)
      )
      const tool = tools.find((candidate) => candidate.id === `oracle_epm_fccs_${contract.id}`)!
      const response = await executeOracleEpmFccsTool({
        toolId: tool.id,
        input: tool.operation.input({ ...AUTH, ...contract.input }),
        headers: new Headers(),
        requestId: 'fccs-test',
        context: {
          userId: 'user',
          workspaceId: 'workspace',
          workflowId: 'workflow',
          executionId: 'execution',
        },
      })
      const result = await response.json()
      expect(result, contract.source).toEqual({ success: true, output: contract.expected })
      const calls = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls
      expect(calls).toHaveLength(contract.preflight ? 2 : 1)
      const [url, ip, request] = calls.at(-1)!
      const expected = new URL(AUTH.instanceUrl + contract.path)
      for (const [key, value] of Object.entries(contract.query ?? {}))
        expected.searchParams.set(key, String(value))
      /** Compare query objects separately: Oracle query parameter ordering is not semantic. */
      expect(new URL(url).pathname).toBe(expected.pathname)
      expect(Object.fromEntries(new URL(url).searchParams)).toEqual(
        Object.fromEntries(expected.searchParams)
      )
      expect(new URL(url).origin).toBe('https://epm.example.com')
      expect(ip).toBe('203.0.113.10')
      expect(request.method).toBe(contract.method)
      expect(request.maxRedirects).toBe(0)
      expect(request.headers.Authorization).toBe(`Basic ${AUTH.accessToken}`)
      if (contract.id === 'upload_file') expect(Buffer.from(request.body).toString()).toBe('abc')
      else if (contract.body === undefined) expect(request.body).toBeUndefined()
      else expect(JSON.parse(request.body)).toEqual(contract.body)
      expect(result.output).not.toHaveProperty('undocumentedCanary')
    }
  )
})
