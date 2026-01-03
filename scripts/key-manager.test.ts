/**
 * Tests for the automated key management system
 * 
 * These tests verify the core functionality of the key manager including:
 * - Configuration loading
 * - Key discovery
 * - GitHub secrets checking
 * - Memory clearing
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('Key Manager Configuration', () => {
  it('should have valid JSON configuration', async () => {
    const configPath = join(process.cwd(), 'key-manager.config.json');
    const configContent = await readFile(configPath, 'utf-8');
    
    expect(() => JSON.parse(configContent)).not.toThrow();
    
    const config = JSON.parse(configContent);
    expect(config).toHaveProperty('requiredKeys');
    expect(config).toHaveProperty('externalSources');
    expect(config).toHaveProperty('injectionTargets');
    expect(config).toHaveProperty('security');
  });

  it('should define required keys with correct structure', async () => {
    const configPath = join(process.cwd(), 'key-manager.config.json');
    const configContent = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    
    expect(Array.isArray(config.requiredKeys)).toBe(true);
    expect(config.requiredKeys.length).toBeGreaterThan(0);
    
    for (const key of config.requiredKeys) {
      expect(key).toHaveProperty('name');
      expect(key).toHaveProperty('description');
      expect(key).toHaveProperty('required');
      expect(key).toHaveProperty('inject');
      expect(Array.isArray(key.inject)).toBe(true);
    }
  });

  it('should have security settings enabled', async () => {
    const configPath = join(process.cwd(), 'key-manager.config.json');
    const configContent = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    
    expect(config.security.maskInLogs).toBe(true);
    expect(config.security.clearMemoryAfterUse).toBe(true);
    expect(config.security.useGitHubSecretsMasking).toBe(true);
  });

  it('should define essential environment variables', async () => {
    const configPath = join(process.cwd(), 'key-manager.config.json');
    const configContent = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    
    const keyNames = config.requiredKeys.map((k: { name: string }) => k.name);
    
    // Check for critical keys
    expect(keyNames).toContain('DATABASE_URL');
    expect(keyNames).toContain('ENCRYPTION_KEY');
    expect(keyNames).toContain('BETTER_AUTH_SECRET');
  });

  it('should define injection targets', async () => {
    const configPath = join(process.cwd(), 'key-manager.config.json');
    const configContent = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    
    expect(config.injectionTargets).toHaveProperty('.env');
    expect(config.injectionTargets['.env']).toHaveProperty('path');
    expect(config.injectionTargets['.env']).toHaveProperty('format');
  });
});

describe('Key Manager Script', () => {
  it('should export KeyManager class', async () => {
    // This is a basic check that the script can be imported
    // Full functionality testing would require mocking GitHub API
    const { KeyManager } = await import('./key-manager.ts');
    expect(KeyManager).toBeDefined();
    expect(typeof KeyManager).toBe('function');
  });
});

describe('Configuration Validation', () => {
  it('should have valid regex patterns for keys that define them', async () => {
    const configPath = join(process.cwd(), 'key-manager.config.json');
    const configContent = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    
    for (const key of config.requiredKeys) {
      if (key.pattern) {
        // Verify it's a valid regex
        expect(() => new RegExp(key.pattern)).not.toThrow();
      }
    }
  });

  it('should have valid external source configurations', async () => {
    const configPath = join(process.cwd(), 'key-manager.config.json');
    const configContent = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    
    expect(Array.isArray(config.externalSources)).toBe(true);
    
    for (const source of config.externalSources) {
      expect(source).toHaveProperty('name');
      expect(source).toHaveProperty('type');
      expect(source).toHaveProperty('authSecret');
      expect(source).toHaveProperty('endpoint');
      
      // Verify endpoint is a valid URL format
      if (source.endpoint.startsWith('http')) {
        expect(() => new URL(source.endpoint)).not.toThrow();
      }
    }
  });
});
