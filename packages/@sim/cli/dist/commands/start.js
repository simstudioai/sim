"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.start = start;
const chalk_1 = __importDefault(require("chalk"));
const child_process_1 = require("child_process");
const child_process_2 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const fs_2 = require("fs");
const https_1 = __importDefault(require("https"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const tar_1 = require("tar");
const config_1 = require("../utils/config");
const spinner_1 = require("../utils/spinner");
// Constants for standalone app
const SIM_HOME_DIR = path_1.default.join(os_1.default.homedir(), '.sim-studio');
const SIM_STANDALONE_DIR = path_1.default.join(SIM_HOME_DIR, 'standalone');
const SIM_VERSION_FILE = path_1.default.join(SIM_HOME_DIR, 'version.json');
const DOWNLOAD_URL = 'https://github.com/simstudioai/sim/releases/download/v0.1.0/sim-standalone.tar.gz';
const STANDALONE_VERSION = '0.1.0';
/**
 * Start command that launches Sim Studio using local storage
 */
async function start(options) {
    // Update config with provided options
    config_1.config.set('port', options.port);
    config_1.config.set('debug', options.debug);
    config_1.config.set('lastRun', new Date().toISOString());
    const port = options.port || '3000';
    const debug = options.debug || false;
    // Show starting message
    const spinner = (0, spinner_1.createSpinner)(`Starting Sim Studio on port ${port}...`).start();
    try {
        // Set environment variables for using local storage
        const env = {
            ...process.env,
            PORT: port,
            USE_LOCAL_STORAGE: 'true', // Key environment variable to switch to local storage
            NODE_ENV: debug ? 'development' : 'production',
            DEBUG: debug ? '*' : undefined,
        };
        // Try to find the main package.json to determine if we're running from within the repo
        // or as an installed npm package
        const isInProjectDirectory = checkIfInProjectDirectory();
        let simProcess;
        if (isInProjectDirectory) {
            // Running from within the project directory - we'll use the existing
            // Next.js setup directly
            spinner.text = 'Detected Sim Studio project, starting with local configuration...';
            simProcess = (0, child_process_1.spawn)('npm', ['run', 'dev'], {
                env,
                stdio: 'inherit',
                shell: true,
            });
        }
        else {
            // Running from outside the project via npx - we'll download and start a standalone version
            spinner.text = 'Setting up standalone Sim Studio...';
            // Create the .sim-studio directory if it doesn't exist
            if (!fs_1.default.existsSync(SIM_HOME_DIR)) {
                fs_1.default.mkdirSync(SIM_HOME_DIR, { recursive: true });
            }
            // Check if we already have the standalone version
            let needsDownload = true;
            if (fs_1.default.existsSync(SIM_VERSION_FILE)) {
                try {
                    const versionInfo = JSON.parse(fs_1.default.readFileSync(SIM_VERSION_FILE, 'utf8'));
                    if (versionInfo.version === STANDALONE_VERSION) {
                        needsDownload = false;
                    }
                }
                catch (error) {
                    // If there's an error reading the version file, download again
                    needsDownload = true;
                }
            }
            // Download and extract if needed
            if (needsDownload) {
                try {
                    await downloadStandaloneApp(spinner);
                }
                catch (error) {
                    spinner.fail(`Failed to download Sim Studio: ${error instanceof Error ? error.message : String(error)}`);
                    console.log(`\n${chalk_1.default.yellow('⚠️')} If you're having network issues, you can try:
  1. Check your internet connection
  2. Try again later
  3. Run Sim Studio directly from a cloned repository`);
                    process.exit(1);
                }
            }
            else {
                spinner.text = 'Using cached Sim Studio standalone version...';
            }
            // Start the standalone app
            spinner.text = 'Starting Sim Studio standalone...';
            // Make sure the standalone directory exists
            if (!fs_1.default.existsSync(SIM_STANDALONE_DIR) ||
                !fs_1.default.existsSync(path_1.default.join(SIM_STANDALONE_DIR, 'server.js'))) {
                spinner.fail('Standalone app files are missing. Re-run to download again.');
                // Force a fresh download next time
                if (fs_1.default.existsSync(SIM_VERSION_FILE)) {
                    fs_1.default.unlinkSync(SIM_VERSION_FILE);
                }
                process.exit(1);
            }
            // Start the standalone Node.js server
            const standaloneEnv = {
                ...env,
                SIM_STUDIO_PORT: port,
            };
            simProcess = (0, child_process_1.spawn)('node', ['server.js'], {
                cwd: SIM_STANDALONE_DIR,
                env: standaloneEnv,
                stdio: 'inherit',
                shell: true,
            });
        }
        // Successful start
        spinner.succeed(`Sim Studio is running on ${chalk_1.default.cyan(`http://localhost:${port}`)}`);
        console.log(`
${chalk_1.default.green('✓')} Using local storage mode - your data will be stored in the browser
${chalk_1.default.green('✓')} Any changes will be persisted between sessions through localStorage
${chalk_1.default.yellow('i')} Press ${chalk_1.default.bold('Ctrl+C')} to stop the server
`);
        // Handle process termination
        process.on('SIGINT', () => {
            console.log(`\n${chalk_1.default.yellow('⚠️')} Shutting down Sim Studio...`);
            simProcess.kill('SIGINT');
            process.exit(0);
        });
        // Return the process for testing purposes
        return simProcess;
    }
    catch (error) {
        spinner.fail('Failed to start Sim Studio');
        console.error(chalk_1.default.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
/**
 * Checks if we're running in a Sim Studio project directory
 */
function checkIfInProjectDirectory() {
    // Check if we have package.json that looks like a Sim Studio project
    try {
        const packageJsonPath = path_1.default.join(process.cwd(), 'package.json');
        if (fs_1.default.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs_1.default.readFileSync(packageJsonPath, 'utf8'));
            // Check if it looks like our project
            if (packageJson.name === 'sim' ||
                packageJson.name === 'sim-studio' ||
                (packageJson.dependencies &&
                    (packageJson.dependencies['next'] || packageJson.dependencies['@sim/cli']))) {
                return true;
            }
        }
        // Also check for Next.js app files
        const nextConfigPath = path_1.default.join(process.cwd(), 'next.config.js');
        const nextTsConfigPath = path_1.default.join(process.cwd(), 'next.config.ts');
        if (fs_1.default.existsSync(nextConfigPath) || fs_1.default.existsSync(nextTsConfigPath)) {
            return true;
        }
    }
    catch (error) {
        // If we can't read/parse package.json, assume we're not in a project directory
    }
    return false;
}
/**
 * Downloads and extracts the standalone app
 */
async function downloadStandaloneApp(spinner) {
    return new Promise((resolve, reject) => {
        // Create temp directory
        const tmpDir = path_1.default.join(os_1.default.tmpdir(), `sim-download-${Date.now()}`);
        fs_1.default.mkdirSync(tmpDir, { recursive: true });
        const tarballPath = path_1.default.join(tmpDir, 'sim-standalone.tar.gz');
        const file = (0, fs_2.createWriteStream)(tarballPath);
        spinner.text = 'Downloading Sim Studio...';
        // Download the tarball
        https_1.default
            .get(DOWNLOAD_URL, (response) => {
            if (response.statusCode !== 200) {
                spinner.fail(`Failed to download: ${response.statusCode}`);
                return reject(new Error(`Download failed with status code: ${response.statusCode}`));
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                // Clear the standalone directory if it exists
                if (fs_1.default.existsSync(SIM_STANDALONE_DIR)) {
                    fs_1.default.rmSync(SIM_STANDALONE_DIR, { recursive: true, force: true });
                }
                // Create the directory
                fs_1.default.mkdirSync(SIM_STANDALONE_DIR, { recursive: true });
                spinner.text = 'Extracting Sim Studio...';
                // Extract the tarball
                (0, tar_1.extract)({
                    file: tarballPath,
                    cwd: SIM_STANDALONE_DIR,
                })
                    .then(() => {
                    // Clean up
                    fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
                    // Install dependencies if needed
                    if (fs_1.default.existsSync(path_1.default.join(SIM_STANDALONE_DIR, 'package.json'))) {
                        spinner.text = 'Installing dependencies...';
                        try {
                            (0, child_process_2.execSync)('npm install --production', {
                                cwd: SIM_STANDALONE_DIR,
                                stdio: 'ignore',
                            });
                        }
                        catch (error) {
                            spinner.warn('Error installing dependencies, but trying to continue...');
                        }
                    }
                    // Write version file
                    fs_1.default.writeFileSync(SIM_VERSION_FILE, JSON.stringify({ version: STANDALONE_VERSION, date: new Date().toISOString() }));
                    spinner.succeed('Sim Studio downloaded successfully');
                    resolve();
                })
                    .catch((err) => {
                    spinner.fail('Failed to extract Sim Studio');
                    reject(err);
                });
            });
        })
            .on('error', (err) => {
            spinner.fail('Network error');
            reject(err);
        });
    });
}
