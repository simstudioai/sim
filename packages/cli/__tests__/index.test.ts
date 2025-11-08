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
            port: 3000,
            pullImages: true,
            yes: false,
            dataDir: '/home/user/.simstudio/data',
            networkName: 'simstudio-network',
            dbContainer: 'simstudio-db',
            migrationsContainer: 'simstudio-migrations',
            realtimeContainer: 'simstudio-realtime',
            appContainer: 'simstudio-app',
            dbImage: 'pgvector/pgvector:pg17',
            migrationsImage: 'ghcr.io/simstudioai/migrations:latest',
            realtimeImage: 'ghcr.io/simstudioai/realtime:latest',
            appImage: 'ghcr.io/simstudioai/simstudio:latest',
            postgresUser: 'postgres',
            postgresPassword: 'postgres',
            postgresDb: 'simstudio',
            realtimePort: 3002,
            betterAuthSecret: 'test-secret-32chars-long-enough-1234567890',
            encryptionKey: 'test-encryption-32chars-long-1234567890abcd',
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
        let net: any;

        beforeEach(() => {
            net = require('net');
        });

        it('should return true if port is available', async () => {
            jest.spyOn(net, 'createServer').mockImplementation(() => {
                return {
                    once: jest.fn().mockImplementation((event: string, cb: () => void) => {
                        if (event === 'listening') setImmediate(cb);
                    }),
                    listen: jest.fn(),
                    close: jest.fn().mockImplementation((cb: () => void) => cb && cb()),
                } as any;
            });

            const available = await indexModule.isPortAvailable(3000);
            expect(available).toBe(true);
        });

        it('should return false if port is in use (EADDRINUSE)', async () => {
            jest.spyOn(net, 'createServer').mockImplementation(() => {
                return {
                    once: jest.fn().mockImplementation((event: string, cb: (err?: any) => void) => {
                        if (event === 'error') setImmediate(() => cb({ code: 'EADDRINUSE' }));
                    }),
                    listen: jest.fn(),
                    close: jest.fn(),
                } as any;
            });

            const available = await indexModule.isPortAvailable(3000);
            expect(available).toBe(false);
        });

        it('should return true on any other error (cannot determine)', async () => {
            jest.spyOn(net, 'createServer').mockImplementation(() => {
                return {
                    once: jest.fn().mockImplementation((event: string, cb: (err?: any) => void) => {
                        if (event === 'error') setImmediate(() => cb({ code: 'EPERM' }));
                    }),
                    listen: jest.fn(),
                    close: jest.fn(),
                } as any;
            });

            const available = await indexModule.isPortAvailable(3000);
            expect(available).toBe(true);
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
        it('should resolve true if PG becomes ready', async () => {
            let attempts = 0;
            mockExecSync.mockImplementation(() => {
                attempts++;
                if (attempts === 2) return Buffer.from('ready');
                throw new Error('not ready');
            });

            const ready = await indexModule.waitForPgReady('test-db', 5000);
            expect(ready).toBe(true);
        });

        it('should resolve false after timeout and print correct message', async () => {
            mockExecSync.mockImplementation(() => {
                throw new Error('not ready');
            });

            const ready = await indexModule.waitForPgReady('test-db', 200);
            expect(ready).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('failed to become ready within 0m0.2s')
            );
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
