/**
 * Capacitor Plugin Mocks for Testing
 * Provides mock implementations of Capacitor plugins used in the iOS app
 */

import { vi } from 'vitest';

// Mock file system storage
const mockFileStorage = new Map();

/**
 * Mock Capacitor Filesystem
 */
export const mockFilesystem = {
  // Read file
  readFile: vi.fn(async ({ path, directory, encoding }) => {
    const key = `${directory}:${path}`;
    const data = mockFileStorage.get(key);
    if (data === undefined) {
      throw new Error(`File does not exist: ${path}`);
    }
    return { data };
  }),

  // Write file
  writeFile: vi.fn(async ({ path, directory, data, encoding }) => {
    const key = `${directory}:${path}`;
    mockFileStorage.set(key, data);
    return { uri: `file://${path}` };
  }),

  // Create directory
  mkdir: vi.fn(async ({ path, directory, recursive }) => {
    const key = `${directory}:${path}`;
    mockFileStorage.set(key, '__DIR__');
    return {};
  }),

  // Read directory
  readdir: vi.fn(async ({ path, directory }) => {
    const prefix = `${directory}:${path}`;
    const files = [];
    for (const [key] of mockFileStorage) {
      if (key.startsWith(prefix) && key !== prefix) {
        const relativePath = key.slice(prefix.length + 1);
        const parts = relativePath.split('/');
        if (parts.length === 1) {
          files.push({
            name: parts[0],
            type: mockFileStorage.get(key) === '__DIR__' ? 'directory' : 'file'
          });
        }
      }
    }
    return { files };
  }),

  // Get file info
  stat: vi.fn(async ({ path, directory }) => {
    const key = `${directory}:${path}`;
    if (!mockFileStorage.has(key)) {
      throw new Error(`File does not exist: ${path}`);
    }
    return {
      type: mockFileStorage.get(key) === '__DIR__' ? 'directory' : 'file',
      size: 1024,
      mtime: Date.now(),
      uri: `file://${path}`
    };
  }),

  // Delete file
  deleteFile: vi.fn(async ({ path, directory }) => {
    const key = `${directory}:${path}`;
    mockFileStorage.delete(key);
    return {};
  }),

  // Remove directory
  rmdir: vi.fn(async ({ path, directory, recursive }) => {
    const prefix = `${directory}:${path}`;
    for (const key of mockFileStorage.keys()) {
      if (key.startsWith(prefix)) {
        mockFileStorage.delete(key);
      }
    }
    return {};
  }),

  // Rename/move file
  rename: vi.fn(async ({ from, to, directory, toDirectory }) => {
    const fromKey = `${directory}:${from}`;
    const toKey = `${toDirectory || directory}:${to}`;
    const data = mockFileStorage.get(fromKey);
    mockFileStorage.delete(fromKey);
    mockFileStorage.set(toKey, data);
    return {};
  }),

  // Copy file
  copy: vi.fn(async ({ from, to, directory, toDirectory }) => {
    const fromKey = `${directory}:${from}`;
    const toKey = `${toDirectory || directory}:${to}`;
    const data = mockFileStorage.get(fromKey);
    mockFileStorage.set(toKey, data);
    return {};
  }),

  // Download file
  downloadFile: vi.fn(async ({ url, path, directory, progress }) => {
    const key = `${directory}:${path}`;
    mockFileStorage.set(key, 'downloaded-content');
    return { path };
  }),

  // Helper: Reset storage
  __reset: () => mockFileStorage.clear(),

  // Helper: Set file content directly
  __setFile: (directory, path, content) => {
    mockFileStorage.set(`${directory}:${path}`, content);
  },

  // Helper: Get file content directly
  __getFile: (directory, path) => {
    return mockFileStorage.get(`${directory}:${path}`);
  }
};

/**
 * Mock Capacitor Preferences
 */
const mockPreferencesStorage = new Map();

export const mockPreferences = {
  get: vi.fn(async ({ key }) => {
    const value = mockPreferencesStorage.get(key);
    return { value: value ?? null };
  }),

  set: vi.fn(async ({ key, value }) => {
    mockPreferencesStorage.set(key, value);
    return {};
  }),

  remove: vi.fn(async ({ key }) => {
    mockPreferencesStorage.delete(key);
    return {};
  }),

  clear: vi.fn(async () => {
    mockPreferencesStorage.clear();
    return {};
  }),

  keys: vi.fn(async () => {
    return { keys: Array.from(mockPreferencesStorage.keys()) };
  }),

  // Helper: Reset storage
  __reset: () => mockPreferencesStorage.clear(),

  // Helper: Set value directly
  __set: (key, value) => mockPreferencesStorage.set(key, value)
};

/**
 * Mock Capacitor Secure Storage (Keychain)
 */
const mockKeychainStorage = new Map();

export const mockSecureStorage = {
  getItem: vi.fn(async (key) => {
    const value = mockKeychainStorage.get(key);
    return value ?? null;
  }),

  setItem: vi.fn(async (key, value) => {
    mockKeychainStorage.set(key, value);
    return true;
  }),

  removeItem: vi.fn(async (key) => {
    mockKeychainStorage.delete(key);
    return true;
  }),

  // Helper: Reset storage
  __reset: () => mockKeychainStorage.clear(),

  // Helper: Set value directly
  __set: (key, value) => mockKeychainStorage.set(key, value)
};

/**
 * Mock Capacitor HTTP
 */
export const mockCapacitorHttp = {
  request: vi.fn(async ({ url, method, headers, data }) => {
    // Default mock response
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {}
    };
  }),

  get: vi.fn(async ({ url, headers }) => {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {}
    };
  }),

  post: vi.fn(async ({ url, headers, data }) => {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {}
    };
  })
};

/**
 * Mock Capacitor Haptics
 */
export const mockHaptics = {
  impact: vi.fn(async ({ style }) => {}),
  notification: vi.fn(async ({ type }) => {}),
  vibrate: vi.fn(async () => {}),
  selectionStart: vi.fn(async () => {}),
  selectionChanged: vi.fn(async () => {}),
  selectionEnd: vi.fn(async () => {})
};

/**
 * Mock Directory enum
 */
export const Directory = {
  Documents: 'DOCUMENTS',
  Data: 'DATA',
  Library: 'LIBRARY',
  Cache: 'CACHE',
  External: 'EXTERNAL',
  ICloud: 'ICLOUD'
};

/**
 * Mock Encoding enum
 */
export const Encoding = {
  UTF8: 'utf8',
  ASCII: 'ascii',
  UTF16: 'utf16'
};

/**
 * Reset all mocks
 */
export function resetAllMocks() {
  mockFilesystem.__reset();
  mockPreferences.__reset();
  mockSecureStorage.__reset();
  vi.clearAllMocks();
}

/**
 * Create Capacitor module mock for vi.mock()
 */
export function createCapacitorMock() {
  return {
    Filesystem: mockFilesystem,
    Preferences: mockPreferences,
    Directory,
    Encoding
  };
}
