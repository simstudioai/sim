/**
 * Single source of truth for the dedicated Function sandbox base.
 *
 * Both provider renderers consume these lists:
 * - `build-function-e2b-template.ts` layers them onto E2B's code-interpreter base.
 * - `build-function-daytona-snapshot.ts` builds the equivalent Daytona snapshot.
 *
 * Mothership, document generation, and Pi deliberately own separate images and
 * package manifests. A change here affects only Function code, Shell, and custom
 * workspace sandboxes layered on top of the Function base.
 */

/** Daytona equivalent of the current E2B Python/Debian foundation. */
export const FUNCTION_DAYTONA_PYTHON_VERSION = '3.13.14'
export const FUNCTION_DAYTONA_BASE_IMAGE = `python:${FUNCTION_DAYTONA_PYTHON_VERSION}-slim-trixie@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91`

/** Runtime versions shared by both providers and asserted during every build. */
export const FUNCTION_NODE_MAJOR = 20
export const FUNCTION_DAYTONA_NODE_VERSION = '20.20.2'
export const FUNCTION_PYTHON_MAJOR = 3
export const FUNCTION_PYTHON_MINOR = 13

const FUNCTION_DAYTONA_NODE_ARCHIVE =
  `node-v${FUNCTION_DAYTONA_NODE_VERSION}-linux-x64.tar.xz` as const
export const FUNCTION_DAYTONA_NODE_URL =
  `https://nodejs.org/dist/v${FUNCTION_DAYTONA_NODE_VERSION}/${FUNCTION_DAYTONA_NODE_ARCHIVE}` as const
export const FUNCTION_DAYTONA_NODE_SHA256 =
  'df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d'
export const FUNCTION_DAYTONA_NODE_INSTALL = [
  `curl -fsSL --retry 3 --retry-all-errors '${FUNCTION_DAYTONA_NODE_URL}' -o '/tmp/${FUNCTION_DAYTONA_NODE_ARCHIVE}'`,
  `echo '${FUNCTION_DAYTONA_NODE_SHA256}  /tmp/${FUNCTION_DAYTONA_NODE_ARCHIVE}' | sha256sum -c -`,
  `tar -xJf '/tmp/${FUNCTION_DAYTONA_NODE_ARCHIVE}' -C /usr/local --strip-components=1`,
  `rm -f '/tmp/${FUNCTION_DAYTONA_NODE_ARCHIVE}'`,
].join(' && ')

/**
 * Universal command-line utilities available to JavaScript, Python, and Shell.
 * Provider bootstrap packages live here too so E2B and Daytona cannot drift.
 */
export const FUNCTION_APT_PACKAGES = [
  'bash',
  'bat',
  'bc',
  'bzip2',
  'ca-certificates',
  'coreutils',
  'csvtool',
  'curl',
  'dnsutils',
  'dos2unix',
  'dpkg',
  'fd-find',
  'ffmpeg',
  'file',
  'git',
  'gnupg',
  'gzip',
  'httpie',
  'imagemagick',
  'iproute2',
  'jq',
  'libgl1',
  'libglib2.0-0',
  'libsndfile1',
  'netcat-openbsd',
  'openssh-client',
  'p7zip-full',
  'procps',
  'ripgrep',
  'silversearcher-ag',
  'sqlite3',
  'tar',
  'tree',
  'unzip',
  'wget',
  'xmlstarlet',
  'xz-utils',
  'zip',
] as const

/**
 * Top-level Python distributions inherited from E2B's maintained
 * code-interpreter base and the import each distribution must expose. Daytona
 * installs this exact surface because it starts from a lean Python image; E2B
 * must not reinstall it. Custom dependencies and CLI packages are layered
 * separately. Packages removed from E2B's maintained base are restored through
 * the pinned compatibility additions below.
 */
export const FUNCTION_BASE_PYTHON_PACKAGE_IMPORTS = [
  { distribution: 'numpy', importName: 'numpy' },
  { distribution: 'pandas', importName: 'pandas' },
  { distribution: 'scipy', importName: 'scipy' },
  { distribution: 'sympy', importName: 'sympy' },
  { distribution: 'numba', importName: 'numba' },
  { distribution: 'xarray', importName: 'xarray' },
  { distribution: 'networkx', importName: 'networkx' },
  { distribution: 'scikit-learn', importName: 'sklearn' },
  { distribution: 'scikit-image', importName: 'skimage' },
  { distribution: 'matplotlib', importName: 'matplotlib' },
  { distribution: 'seaborn', importName: 'seaborn' },
  { distribution: 'plotly', importName: 'plotly' },
  { distribution: 'bokeh', importName: 'bokeh' },
  { distribution: 'kaleido', importName: 'kaleido' },
  { distribution: 'pillow', importName: 'PIL' },
  { distribution: 'imageio', importName: 'imageio' },
  { distribution: 'tifffile', importName: 'tifffile' },
  { distribution: 'opencv-python', importName: 'cv2' },
  { distribution: 'librosa', importName: 'librosa' },
  { distribution: 'soundfile', importName: 'soundfile' },
  { distribution: 'spacy', importName: 'spacy' },
  { distribution: 'nltk', importName: 'nltk' },
  { distribution: 'textblob', importName: 'textblob' },
  { distribution: 'gensim', importName: 'gensim' },
  { distribution: 'beautifulsoup4', importName: 'bs4' },
  { distribution: 'lxml', importName: 'lxml' },
  { distribution: 'requests', importName: 'requests' },
  { distribution: 'openpyxl', importName: 'openpyxl' },
  { distribution: 'xlrd', importName: 'xlrd' },
  { distribution: 'python-docx', importName: 'docx' },
  { distribution: 'xmltodict', importName: 'xmltodict' },
  { distribution: 'PyYAML', importName: 'yaml' },
  { distribution: 'tomlkit', importName: 'tomlkit' },
  { distribution: 'simplejson', importName: 'simplejson' },
  { distribution: 'orjson', importName: 'orjson' },
  { distribution: 'SQLAlchemy', importName: 'sqlalchemy' },
  { distribution: 'rich', importName: 'rich' },
  { distribution: 'typer', importName: 'typer' },
  { distribution: 'click', importName: 'click' },
  { distribution: 'tqdm', importName: 'tqdm' },
  { distribution: 'Jinja2', importName: 'jinja2' },
  { distribution: 'pydantic', importName: 'pydantic' },
  { distribution: 'python-dateutil', importName: 'dateutil' },
  { distribution: 'pytz', importName: 'pytz' },
  { distribution: 'psutil', importName: 'psutil' },
  { distribution: 'filetype', importName: 'filetype' },
  { distribution: 'python-slugify', importName: 'slugify' },
  { distribution: 'parsedatetime', importName: 'parsedatetime' },
  { distribution: 'pytimeparse', importName: 'pytimeparse' },
] as const

/** Distribution names installed only when Daytona reconstructs E2B's base. */
export const FUNCTION_BASE_PYTHON_PACKAGES = FUNCTION_BASE_PYTHON_PACKAGE_IMPORTS.map(
  ({ distribution }) => distribution
)

/** Pinned packages required by the Function contract but absent from E2B's current base. */
export const FUNCTION_E2B_PYTHON_PACKAGE_CONTRACT = [
  { package: 'SQLAlchemy', version: '2.0.51' },
  { package: 'parsedatetime', version: '2.6' },
  { package: 'python-slugify', version: '8.0.4' },
  { package: 'pytimeparse', version: '1.1.8' },
  { package: 'tomlkit', version: '0.15.0' },
  { package: 'xmltodict', version: '1.0.4' },
] as const

export const FUNCTION_E2B_PYTHON_PACKAGES = FUNCTION_E2B_PYTHON_PACKAGE_CONTRACT.map(
  ({ package: packageName, version }) => `${packageName}==${version}`
)

/** Pinned generic Python CLIs added on top of the provider's Python surface. */
export const FUNCTION_PIP_CLI_PACKAGE_CONTRACT = [
  { package: 'yq', version: '4.1.2' },
  { package: 'csvkit', version: '2.2.0' },
] as const

export const FUNCTION_PIP_CLI_PACKAGES = FUNCTION_PIP_CLI_PACKAGE_CONTRACT.map(
  ({ package: packageName, version }) => `${packageName}==${version}`
)

/** Pinned generic Node CLIs added on top of the provider's Node runtime. */
export const FUNCTION_NPM_CLI_PACKAGE_CONTRACT = [{ package: 'zx', version: '8.8.5' }] as const

export const FUNCTION_NPM_CLI_PACKAGES = FUNCTION_NPM_CLI_PACKAGE_CONTRACT.map(
  ({ package: packageName, version }) => `${packageName}@${version}`
)

/** Commands the parity harness expects on every default Function sandbox. */
export const FUNCTION_REQUIRED_COMMANDS = [
  'bash',
  'bat',
  'bc',
  'bzip2',
  'convert',
  'csvcut',
  'csvtool',
  'curl',
  'dig',
  'dos2unix',
  'dpkg-deb',
  'fd',
  'ffmpeg',
  'file',
  'git',
  'gzip',
  'http',
  'install',
  'ip',
  'jq',
  'nc',
  'node',
  'npm',
  'python3',
  'rg',
  'sha256sum',
  'ag',
  'sqlite3',
  'tar',
  'tree',
  'unzip',
  'wget',
  'xmlstarlet',
  'xz',
  'yq',
  '7z',
  'zip',
  'zx',
] as const

/** Normalizes Debian's renamed binaries to their conventional user-facing names. */
export const FUNCTION_COMMAND_ALIASES_SETUP = [
  'if command -v fdfind >/dev/null; then ln -sfn "$(command -v fdfind)" /usr/local/bin/fd; fi',
  'if command -v batcat >/dev/null; then ln -sfn "$(command -v batcat)" /usr/local/bin/bat; fi',
].join(' && ')

/** Ensures the normalized commands resolve to working executables. */
export const FUNCTION_COMMAND_ALIASES_ASSERT = 'fd --version >/dev/null && bat --version >/dev/null'

export const FUNCTION_NODE_VERSION_ASSERT = `node -e "if (Number(process.versions.node.split('.')[0]) !== ${FUNCTION_NODE_MAJOR}) process.exit(1)"`
export const FUNCTION_DAYTONA_NODE_VERSION_ASSERT = `node -e "if (process.versions.node !== '${FUNCTION_DAYTONA_NODE_VERSION}') process.exit(1)"`
export const FUNCTION_PYTHON_VERSION_ASSERT = `python3 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (${FUNCTION_PYTHON_MAJOR}, ${FUNCTION_PYTHON_MINOR}) else 1)"`
export const FUNCTION_COMMANDS_ASSERT = `for command in ${FUNCTION_REQUIRED_COMMANDS.join(' ')}; do command -v "$command" >/dev/null || exit 1; done`
export const FUNCTION_PYTHON_IMPORTS_ASSERT = `python3 -c 'import importlib, importlib.metadata as metadata; packages = ${JSON.stringify(FUNCTION_BASE_PYTHON_PACKAGE_IMPORTS)}; [(metadata.version(item["distribution"]), importlib.import_module(item["importName"])) for item in packages]'`
export const FUNCTION_PIP_CLI_VERSIONS_ASSERT = `python3 -c 'import importlib.metadata as metadata; packages = ${JSON.stringify(FUNCTION_PIP_CLI_PACKAGE_CONTRACT)}; assert all(metadata.version(item["package"]) == item["version"] for item in packages)'`
export const FUNCTION_NPM_CLI_VERSIONS_ASSERT = `node -e 'const { execFileSync } = require("node:child_process"); const { readFileSync } = require("node:fs"); const { join } = require("node:path"); const root = execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim(); const packages = ${JSON.stringify(FUNCTION_NPM_CLI_PACKAGE_CONTRACT)}; for (const item of packages) { const manifest = JSON.parse(readFileSync(join(root, item.package, "package.json"), "utf8")); if (manifest.version !== item.version) process.exit(1) }'`

/** Surface the live provider-parity harness must resolve into an exact manifest. */
export const FUNCTION_SANDBOX_PARITY_CONTRACT = {
  runtime: {
    nodeMajor: FUNCTION_NODE_MAJOR,
    python: `${FUNCTION_PYTHON_MAJOR}.${FUNCTION_PYTHON_MINOR}`,
  },
  pythonPackages: FUNCTION_BASE_PYTHON_PACKAGE_IMPORTS,
  pipCliPackages: FUNCTION_PIP_CLI_PACKAGE_CONTRACT,
  npmCliPackages: FUNCTION_NPM_CLI_PACKAGE_CONTRACT,
  commands: FUNCTION_REQUIRED_COMMANDS,
} as const

/** Provider resource requests are expressed in different units. */
