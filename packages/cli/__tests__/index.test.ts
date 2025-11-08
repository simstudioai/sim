import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as indexModule from '../src/index';

jest.mock('child_process');
jest.mock('fs');
jest.mock('os');
jest.mock('path');
jest.mock('readline');

const mockExecSync = execSync as jest.MockedFunction < typeof execSync > ;
const mockSpawn = spawn as jest.MockedFunction < typeof spawn > ;
const mockExistsSync = existsSync as jest.MockedFunction < typeof existsSync > ;
const mockMkdirSync = mkdirSync as jest.MockedFunction < typeof mkdirSync > ;
const mockHomedir = homedir as jest.MockedFunction < typeof homedir > ;
const mockJoin = join as jest.MockedFunction < typeof join > ;

describe('SimStudio CLI', () => {
    let config: indexModule.Config;
    let mockSpawnProcess: any;
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();

        config = {
            ...indexModule.DEFAULT_CONFIG,
            port: 3000,
            realtimePort: 3002,
            betterAuthSecret: 'test-secret-32chars-long-enough',
            encryptionKey: 'test-encryption-32chars-long',
        } as indexModule.Config;

        mockHomedir.mockReturnValue('/home/user');
        mockJoin.mockImplementation((...args) => args.join('/'));

        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        // Mock spawn return value
        mockSpawnProcess = {
            on: jest.fn().mockImplementation((event: string, cb: Function) => {
                if (event === 'close') cb(0);
                return mockSpawnProcess;
            }),
        };
        mockSpawn.mockReturnValue(mockSpawnProcess);
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    describe('generateSecret', () => {
        it('should generate a secret of specified length', () => {
            const secret = indexModule.generateSecret(16);
            expect(secret).toHaveLength(16);
            expect(secret).toMatch(/^[a-zA-Z0-9]+$/);
        });

        it('should default to 32 characters', () => {
            const secret = indexModule.generateSecret();
            expect(secret).toHaveLength(32);
        });
    });

    describe('isPortAvailable', () => {
        it('should return true if port is available (command throws)', async () => {
            mockExecSync.mockImplementation(() => {
                throw new Error('Port not in use');
            });

            const available = await indexModule.isPortAvailable(3000);
            expect(available).toBe(true);
        });

        it('should return false if port is in use (command succeeds)', async () => {
            mockExecSync.mockReturnValue(Buffer.from('output'));

            const available = await indexModule.isPortAvailable(3000);
            expect(available).toBe(false);
        });
    });

    describe('isDockerRunning', () => {
        it('should resolve true if Docker info succeeds', async () => {
            mockSpawnProcess.on.mockImplementation((event: string, cb: Function) => {
                if (event === 'close') cb(0);
                return mockSpawnProcess;
            });

            const running = await indexModule.isDockerRunning();
            expect(running).toBe(true);
            expect(mockSpawn).toHaveBeenCalledWith('docker', ['info'], {
                stdio: 'ignore'
            });
        });

        it('should resolve false if Docker info fails', async () => {
            mockSpawnProcess.on.mockImplementation((event: string, cb: Function) => {
                if (event === 'close') cb(1);
                return mockSpawnProcess;
            });

            const running = await indexModule.isDockerRunning();
            expect(running).toBe(false);
        });

        it('should resolve false on spawn error', async () => {
            const errorProcess: any = {
                on: jest.fn((event: string, cb: Function) => {
                    if (event === 'error') cb(new Error('spawn error'));
                    return errorProcess;
                }),
            };
            mockSpawn.mockReturnValueOnce(errorProcess as any);

            const running = await indexModule.isDockerRunning();
            expect(running).toBe(false);
        });
    });

    describe('runCommand', () => {
        it('should resolve true if command succeeds (code 0)', async () => {
            mockSpawnProcess.on.mockImplementation((event: string, cb: Function) => {
                if (event === 'close') cb(0);
                return mockSpawnProcess;
            });

            const success = await indexModule.runCommand(['docker', 'ps']);
            expect(success).toBe(true);
            expect(mockSpawn).toHaveBeenCalledWith('docker', ['ps'], {
                stdio: 'inherit'
            });
        });

        it('should resolve false if command fails (code 1)', async () => {
            mockSpawnProcess.on.mockImplementation((event: string, cb: Function) => {
                if (event === 'close') cb(1);
                return mockSpawnProcess;
            });

            const success = await indexModule.runCommand(['docker', 'ps']);
            expect(success).toBe(false);
        });

        it('should resolve false on spawn error', async () => {
            const errorProcess: any = {
                on: jest.fn((event: string, cb: Function) => {
                    if (event === 'error') cb(new Error('error'));
                    return errorProcess;
                }),
            };
            mockSpawn.mockReturnValueOnce(errorProcess as any);

            const success = await indexModule.runCommand(['docker', 'ps']);
            expect(success).toBe(false);
        });
    });

    describe('pullImage', () => {
        it('should return true if pull succeeds', async () => {
            const success = await indexModule.pullImage('test:image');
            expect(success).toBe(true);
            expect(mockSpawn).toHaveBeenCalledWith('docker', ['pull', 'test:image'], {
                stdio: 'inherit'
            });
        });

        it('should return false if pull fails', async () => {
            mockSpawnProcess.on.mockImplementation((event: string, cb: Function) => {
                if (event === 'close') cb(1);
                return mockSpawnProcess;
            });

            const success = await indexModule.pullImage('test:image');
            expect(success).toBe(false);
        });
    });

    describe('stopAndRemoveContainer', () => {
        it('should stop and remove container successfully', async () => {
            await indexModule.stopAndRemoveContainer('test-container');
            expect(mockSpawn).toHaveBeenCalledWith('docker', ['stop', 'test-container'], {
                stdio: 'inherit'
            });
            expect(mockSpawn).toHaveBeenCalledWith('docker', ['rm', 'test-container'], {
                stdio: 'inherit'
            });
        });
    });

    describe('cleanupExistingContainers', () => {
        it('should call stopAndRemove for all containers', async () => {
            await indexModule.cleanupExistingContainers(config);
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Cleaning up'));
        });
    });

    describe('ensureDataDir', () => {
        it('should create directory if it does not exist', () => {
            mockExistsSync.mockReturnValueOnce(false);

            const success = indexModule.ensureDataDir('/test/dir');
            expect(success).toBe(true);
            expect(mockMkdirSync).toHaveBeenCalledWith('/test/dir', {
                recursive: true
            });
        });

        it('should return true if directory exists', () => {
            mockExistsSync.mockReturnValueOnce(true);

            const success = indexModule.ensureDataDir('/test/dir');
            expect(success).toBe(true);
            expect(mockMkdirSync).not.toHaveBeenCalled();
        });

        it('should return false on mkdir error', () => {
            mockExistsSync.mockReturnValueOnce(false);
            mockMkdirSync.mockImplementation(() => {
                throw new Error('mkdir error');
            });

            const success = indexModule.ensureDataDir('/test/dir');
            expect(success).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalled();
        });
    });

    describe('startDatabase', () => {
        it('should construct and run DB start command successfully', async () => {
            const success = await indexModule.startDatabase(config);
            expect(success).toBe(true);
            expect(mockSpawn).toHaveBeenCalledWith('docker', expect.arrayContaining([
                'run', '-d', '--name', config.dbContainer,
                '--network', config.networkName,
            ]), {
                stdio: 'inherit'
            });
        });

        it('should return false if command fails', async () => {
            mockSpawnProcess.on.mockImplementation((event: string, cb: Function) => {
                if (event === 'close') cb(1);
                return mockSpawnProcess;
            });

            const success = await indexModule.startDatabase(config);
            expect(success).toBe(false);
        });
    });

    describe('waitForPgReady', () => {
        it('should resolve true if PG becomes ready quickly', async () => {
            let attempts = 0;
            mockExecSync.mockImplementation(() => {
                attempts++;
                if (attempts === 2) {
                    return Buffer.from('ready');
                }
                throw new Error('not ready');
            });

            const ready = await indexModule.waitForPgReady('test-db', 5000);
            expect(ready).toBe(true);
            expect(mockExecSync).toHaveBeenCalled();
        });

        it('should resolve false after timeout', async () => {
            mockExecSync.mockImplementation(() => {
                throw new Error('not ready');
            });

            const ready = await indexModule.waitForPgReady('test-db', 100);
            expect(ready).toBe(false);
        });
    });

    describe('runMigrations', () => {
        it('should construct and run migrations command successfully', async () => {
            const success = await indexModule.runMigrations(config);
            expect(success).toBe(true);
            expect(mockSpawn).toHaveBeenCalledWith('docker', expect.arrayContaining([
                'run', '--rm', '--name', config.migrationsContainer,
                '--network', config.networkName,
            ]), {
                stdio: 'inherit'
            });
        });

        it('should return false if command fails', async () => {
            mockSpawnProcess.on.mockImplementation((event: string, cb: Function) => {
                if (event === 'close') cb(1);
                return mockSpawnProcess;
            });

            const success = await indexModule.runMigrations(config);
            expect(success).toBe(false);
        });
    });

    describe('startRealtime', () => {
        it('should construct and run Realtime start command successfully', async () => {
            const success = await indexModule.startRealtime(config);
            expect(success).toBe(true);
            expect(mockSpawn).toHaveBeenCalledWith('docker', expect.arrayContaining([
                'run', '-d', '--name', config.realtimeContainer,
                '--network', config.networkName,
            ]), {
                stdio: 'inherit'
            });
        });

        it('should return false if command fails', async () => {
            mockSpawnProcess.on.mockImplementation((event: string, cb: Function) => {
                if (event === 'close') cb(1);
                return mockSpawnProcess;
            });

            const success = await indexModule.startRealtime(config);
            expect(success).toBe(false);
        });
    });

    describe('startApp', () => {
        it('should construct and run App start command successfully', async () => {
            const success = await indexModule.startApp(config);
            expect(success).toBe(true);
            expect(mockSpawn).toHaveBeenCalledWith('docker', expect.arrayContaining([
                'run', '-d', '--name', config.appContainer,
                '--network', config.networkName,
            ]), {
                stdio: 'inherit'
            });
        });

        it('should return false if command fails', async () => {
            mockSpawnProcess.on.mockImplementation((event: string, cb: Function) => {
                if (event === 'close') cb(1);
                return mockSpawnProcess;
            });

            const success = await indexModule.startApp(config);
            expect(success).toBe(false);
        });
    });

    describe('printSuccess', () => {
        it('should log success messages and stop command', () => {
            indexModule.printSuccess(config);
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Sim is now running'));
        });
    });

    describe('setupShutdownHandlers', () => {
        it('should set up shutdown handlers', () => {
            const mockRl = {
                on: jest.fn(),
                close: jest.fn(),
            };
            const mockCreateInterface = require('readline').createInterface;
            mockCreateInterface.mockReturnValue(mockRl);

            const processOnSpy = jest.spyOn(process, 'on');

            indexModule.setupShutdownHandlers(config);

            expect(mockCreateInterface).toHaveBeenCalled();
            expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
            expect(processOnSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));

            processOnSpy.mockRestore();
        });
    });
});
