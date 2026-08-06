/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  FUNCTION_APT_PACKAGES,
  FUNCTION_BASE_PYTHON_PACKAGE_IMPORTS,
  FUNCTION_BASE_PYTHON_PACKAGES,
  FUNCTION_COMMAND_ALIASES_ASSERT,
  FUNCTION_COMMAND_ALIASES_SETUP,
  FUNCTION_COMMANDS_ASSERT,
  FUNCTION_DAYTONA_BASE_IMAGE,
  FUNCTION_DAYTONA_NODE_INSTALL,
  FUNCTION_DAYTONA_NODE_SHA256,
  FUNCTION_DAYTONA_NODE_URL,
  FUNCTION_DAYTONA_NODE_VERSION,
  FUNCTION_DAYTONA_NODE_VERSION_ASSERT,
  FUNCTION_DAYTONA_PYTHON_VERSION,
  FUNCTION_E2B_PYTHON_PACKAGE_CONTRACT,
  FUNCTION_E2B_PYTHON_PACKAGES,
  FUNCTION_NODE_MAJOR,
  FUNCTION_NODE_VERSION_ASSERT,
  FUNCTION_NPM_CLI_PACKAGE_CONTRACT,
  FUNCTION_NPM_CLI_PACKAGES,
  FUNCTION_NPM_CLI_VERSIONS_ASSERT,
  FUNCTION_PIP_CLI_PACKAGE_CONTRACT,
  FUNCTION_PIP_CLI_PACKAGES,
  FUNCTION_PIP_CLI_VERSIONS_ASSERT,
  FUNCTION_PYTHON_IMPORTS_ASSERT,
  FUNCTION_PYTHON_MAJOR,
  FUNCTION_PYTHON_MINOR,
  FUNCTION_PYTHON_VERSION_ASSERT,
  FUNCTION_REQUIRED_COMMANDS,
  FUNCTION_SANDBOX_PARITY_CONTRACT,
} from '@/scripts/function-sandbox-packages'

describe('Function sandbox package contract', () => {
  it('keeps provider-shared package and command lists unique', () => {
    expect(new Set(FUNCTION_APT_PACKAGES).size).toBe(FUNCTION_APT_PACKAGES.length)
    expect(new Set(FUNCTION_BASE_PYTHON_PACKAGES).size).toBe(FUNCTION_BASE_PYTHON_PACKAGES.length)
    expect(
      new Set(FUNCTION_BASE_PYTHON_PACKAGE_IMPORTS.map(({ importName }) => importName)).size
    ).toBe(FUNCTION_BASE_PYTHON_PACKAGE_IMPORTS.length)
    expect(new Set(FUNCTION_PIP_CLI_PACKAGES).size).toBe(FUNCTION_PIP_CLI_PACKAGES.length)
    expect(new Set(FUNCTION_NPM_CLI_PACKAGES).size).toBe(FUNCTION_NPM_CLI_PACKAGES.length)
    expect(new Set(FUNCTION_REQUIRED_COMMANDS).size).toBe(FUNCTION_REQUIRED_COMMANDS.length)
    expect(FUNCTION_BASE_PYTHON_PACKAGES).toHaveLength(49)
  })

  it('maps every top-level distribution to the import verified by provider builds', () => {
    expect(FUNCTION_BASE_PYTHON_PACKAGES).toEqual(
      FUNCTION_BASE_PYTHON_PACKAGE_IMPORTS.map(({ distribution }) => distribution)
    )
    expect(
      Object.fromEntries(
        FUNCTION_BASE_PYTHON_PACKAGE_IMPORTS.map(
          ({ distribution, importName }) => [distribution, importName] as const
        )
      )
    ).toMatchObject({
      beautifulsoup4: 'bs4',
      Jinja2: 'jinja2',
      'opencv-python': 'cv2',
      pillow: 'PIL',
      'python-dateutil': 'dateutil',
      'python-docx': 'docx',
      'python-slugify': 'slugify',
      PyYAML: 'yaml',
      'scikit-image': 'skimage',
      'scikit-learn': 'sklearn',
      SQLAlchemy: 'sqlalchemy',
    })
    for (const { distribution, importName } of FUNCTION_BASE_PYTHON_PACKAGE_IMPORTS) {
      expect(FUNCTION_PYTHON_IMPORTS_ASSERT).toContain(`"distribution":"${distribution}"`)
      expect(FUNCTION_PYTHON_IMPORTS_ASSERT).toContain(`"importName":"${importName}"`)
    }
  })

  it('includes the universal CLI and Python surface exercised by Functions', () => {
    expect(FUNCTION_REQUIRED_COMMANDS).toEqual(
      expect.arrayContaining([
        '7z',
        'ag',
        'bat',
        'bzip2',
        'curl',
        'csvcut',
        'fd',
        'git',
        'gzip',
        'http',
        'install',
        'jq',
        'node',
        'python3',
        'rg',
        'sha256sum',
        'sqlite3',
        'tar',
        'unzip',
        'xmlstarlet',
        'xz',
        'yq',
        'zx',
        'dpkg-deb',
      ])
    )
    expect(FUNCTION_BASE_PYTHON_PACKAGES).toEqual(
      expect.arrayContaining([
        'beautifulsoup4',
        'kaleido',
        'networkx',
        'numpy',
        'openpyxl',
        'pandas',
        'pytimeparse',
        'PyYAML',
        'requests',
        'SQLAlchemy',
        'tifffile',
        'tomlkit',
        'xmltodict',
      ])
    )
    expect(FUNCTION_PIP_CLI_PACKAGES).toEqual(['yq==4.1.2', 'csvkit==2.2.0'])
    expect(FUNCTION_NPM_CLI_PACKAGES).toEqual(['zx@8.8.5'])
  })

  it('pins and verifies generic CLI package versions in both provider builds', () => {
    for (const { package: packageName, version } of FUNCTION_PIP_CLI_PACKAGE_CONTRACT) {
      expect(FUNCTION_PIP_CLI_VERSIONS_ASSERT).toContain(`"package":"${packageName}"`)
      expect(FUNCTION_PIP_CLI_VERSIONS_ASSERT).toContain(`"version":"${version}"`)
    }
    for (const { package: packageName, version } of FUNCTION_NPM_CLI_PACKAGE_CONTRACT) {
      expect(FUNCTION_NPM_CLI_VERSIONS_ASSERT).toContain(`"package":"${packageName}"`)
      expect(FUNCTION_NPM_CLI_VERSIONS_ASSERT).toContain(`"version":"${version}"`)
    }
    expect(FUNCTION_SANDBOX_PARITY_CONTRACT).toEqual({
      runtime: { nodeMajor: 20, python: '3.13' },
      pythonPackages: FUNCTION_BASE_PYTHON_PACKAGE_IMPORTS,
      pipCliPackages: FUNCTION_PIP_CLI_PACKAGE_CONTRACT,
      npmCliPackages: FUNCTION_NPM_CLI_PACKAGE_CONTRACT,
      commands: FUNCTION_REQUIRED_COMMANDS,
    })
  })

  it('pins only E2B base compatibility additions that belong to the shared surface', () => {
    expect(FUNCTION_E2B_PYTHON_PACKAGES).toEqual([
      'SQLAlchemy==2.0.51',
      'parsedatetime==2.6',
      'python-slugify==8.0.4',
      'pytimeparse==1.1.8',
      'tomlkit==0.15.0',
      'xmltodict==1.0.4',
    ])
    for (const { package: packageName } of FUNCTION_E2B_PYTHON_PACKAGE_CONTRACT) {
      expect(FUNCTION_BASE_PYTHON_PACKAGES).toContain(packageName)
    }
  })

  it('keeps integration and service CLIs out of the universal base', () => {
    expect(FUNCTION_APT_PACKAGES).not.toEqual(
      expect.arrayContaining([
        'default-mysql-client',
        'gh',
        'mysql-client',
        'postgresql-client',
        'redis-tools',
      ])
    )
    expect(FUNCTION_BASE_PYTHON_PACKAGES).not.toContain('awscli')
    expect(
      FUNCTION_PIP_CLI_PACKAGES.every((packageSpec) => !packageSpec.startsWith('awscli'))
    ).toBe(true)
  })

  it('normalizes Debian command names to the conventional Function CLI surface', () => {
    expect(FUNCTION_COMMAND_ALIASES_SETUP).toContain('/usr/local/bin/fd')
    expect(FUNCTION_COMMAND_ALIASES_SETUP).toContain('command -v fdfind')
    expect(FUNCTION_COMMAND_ALIASES_SETUP).toContain('/usr/local/bin/bat')
    expect(FUNCTION_COMMAND_ALIASES_SETUP).toContain('command -v batcat')
    expect(FUNCTION_COMMAND_ALIASES_ASSERT).toContain('fd --version')
    expect(FUNCTION_COMMAND_ALIASES_ASSERT).toContain('bat --version')
  })

  it('asserts the same explicit Node and Python versions at provider build time', () => {
    expect(FUNCTION_NODE_VERSION_ASSERT).toContain(String(FUNCTION_NODE_MAJOR))
    expect(FUNCTION_PYTHON_VERSION_ASSERT).toContain(
      `(${FUNCTION_PYTHON_MAJOR}, ${FUNCTION_PYTHON_MINOR})`
    )
    for (const command of FUNCTION_REQUIRED_COMMANDS) {
      expect(FUNCTION_COMMANDS_ASSERT).toContain(command)
    }
  })

  it('pins Daytona base and Node bootstrap inputs to immutable verified artifacts', () => {
    expect(FUNCTION_DAYTONA_BASE_IMAGE).toMatch(
      /^python:3\.13\.14-slim-trixie@sha256:[0-9a-f]{64}$/
    )
    expect(FUNCTION_DAYTONA_PYTHON_VERSION).toBe('3.13.14')
    expect(FUNCTION_DAYTONA_NODE_VERSION).toBe('20.20.2')
    expect(FUNCTION_DAYTONA_NODE_URL).toContain(
      `/v${FUNCTION_DAYTONA_NODE_VERSION}/node-v${FUNCTION_DAYTONA_NODE_VERSION}-linux-x64.tar.xz`
    )
    expect(FUNCTION_DAYTONA_NODE_SHA256).toMatch(/^[0-9a-f]{64}$/)
    expect(FUNCTION_DAYTONA_NODE_INSTALL).toContain(FUNCTION_DAYTONA_NODE_URL)
    expect(FUNCTION_DAYTONA_NODE_INSTALL).toContain(FUNCTION_DAYTONA_NODE_SHA256)
    expect(FUNCTION_DAYTONA_NODE_INSTALL).toContain('sha256sum -c -')
    expect(FUNCTION_DAYTONA_NODE_INSTALL).not.toContain('nodesource')
    expect(FUNCTION_DAYTONA_NODE_VERSION_ASSERT).toContain(FUNCTION_DAYTONA_NODE_VERSION)
  })
})
