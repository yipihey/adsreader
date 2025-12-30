/**
 * Node.js Filesystem Mock for Testing
 * Provides mock implementations of Node.js fs module
 */

import { vi } from 'vitest';

// Mock file system storage
const mockFileSystem = new Map();
const mockDirectories = new Set();

/**
 * Create mock fs module
 */
export function createFsMock() {
  return {
    existsSync: vi.fn((path) => {
      return mockFileSystem.has(path) || mockDirectories.has(path);
    }),

    mkdirSync: vi.fn((path, options) => {
      if (options?.recursive) {
        // Create all parent directories
        const parts = path.split('/');
        let current = '';
        for (const part of parts) {
          if (part) {
            current += '/' + part;
            mockDirectories.add(current);
          }
        }
      } else {
        mockDirectories.add(path);
      }
    }),

    writeFileSync: vi.fn((path, content, options) => {
      mockFileSystem.set(path, content);
    }),

    readFileSync: vi.fn((path, encoding) => {
      if (!mockFileSystem.has(path)) {
        const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
        error.code = 'ENOENT';
        throw error;
      }
      return mockFileSystem.get(path);
    }),

    readdirSync: vi.fn((path) => {
      const entries = [];
      const prefix = path.endsWith('/') ? path : path + '/';

      for (const [filePath] of mockFileSystem) {
        if (filePath.startsWith(prefix)) {
          const relative = filePath.slice(prefix.length);
          const parts = relative.split('/');
          if (parts.length === 1 && parts[0]) {
            entries.push(parts[0]);
          }
        }
      }

      for (const dirPath of mockDirectories) {
        if (dirPath.startsWith(prefix) && dirPath !== path) {
          const relative = dirPath.slice(prefix.length);
          const parts = relative.split('/');
          if (parts.length === 1 && parts[0] && !entries.includes(parts[0])) {
            entries.push(parts[0]);
          }
        }
      }

      return entries;
    }),

    statSync: vi.fn((path) => {
      const isDir = mockDirectories.has(path);
      const isFile = mockFileSystem.has(path);

      if (!isDir && !isFile) {
        const error = new Error(`ENOENT: no such file or directory, stat '${path}'`);
        error.code = 'ENOENT';
        throw error;
      }

      return {
        isDirectory: () => isDir,
        isFile: () => isFile,
        mtime: new Date(),
        size: isFile ? (mockFileSystem.get(path)?.length || 0) : 0
      };
    }),

    copyFileSync: vi.fn((src, dest) => {
      if (!mockFileSystem.has(src)) {
        const error = new Error(`ENOENT: no such file or directory, copyfile '${src}'`);
        error.code = 'ENOENT';
        throw error;
      }
      mockFileSystem.set(dest, mockFileSystem.get(src));
    }),

    renameSync: vi.fn((oldPath, newPath) => {
      if (!mockFileSystem.has(oldPath) && !mockDirectories.has(oldPath)) {
        const error = new Error(`ENOENT: no such file or directory, rename '${oldPath}'`);
        error.code = 'ENOENT';
        throw error;
      }
      if (mockFileSystem.has(oldPath)) {
        const content = mockFileSystem.get(oldPath);
        mockFileSystem.delete(oldPath);
        mockFileSystem.set(newPath, content);
      }
      if (mockDirectories.has(oldPath)) {
        mockDirectories.delete(oldPath);
        mockDirectories.add(newPath);
      }
    }),

    unlinkSync: vi.fn((path) => {
      if (!mockFileSystem.has(path)) {
        const error = new Error(`ENOENT: no such file or directory, unlink '${path}'`);
        error.code = 'ENOENT';
        throw error;
      }
      mockFileSystem.delete(path);
    }),

    rmSync: vi.fn((path, options) => {
      if (options?.recursive) {
        // Remove all files under this path
        for (const [filePath] of mockFileSystem) {
          if (filePath === path || filePath.startsWith(path + '/')) {
            mockFileSystem.delete(filePath);
          }
        }
        for (const dirPath of mockDirectories) {
          if (dirPath === path || dirPath.startsWith(path + '/')) {
            mockDirectories.delete(dirPath);
          }
        }
      } else {
        mockFileSystem.delete(path);
        mockDirectories.delete(path);
      }
    }),

    rmdirSync: vi.fn((path, options) => {
      if (options?.recursive) {
        for (const [filePath] of mockFileSystem) {
          if (filePath.startsWith(path + '/')) {
            mockFileSystem.delete(filePath);
          }
        }
      }
      mockDirectories.delete(path);
    }),

    // Helpers for test setup
    __reset: () => {
      mockFileSystem.clear();
      mockDirectories.clear();
    },

    __setFile: (path, content) => {
      mockFileSystem.set(path, content);
    },

    __setDir: (path) => {
      mockDirectories.add(path);
    },

    __getFile: (path) => {
      return mockFileSystem.get(path);
    },

    __hasFile: (path) => {
      return mockFileSystem.has(path);
    },

    __hasDir: (path) => {
      return mockDirectories.has(path);
    }
  };
}

/**
 * Create mock electron-store
 */
export function createStoreMock(initialData = {}) {
  const store = new Map(Object.entries(initialData));

  return {
    get: vi.fn((key, defaultValue) => {
      return store.has(key) ? store.get(key) : defaultValue;
    }),

    set: vi.fn((key, value) => {
      store.set(key, value);
    }),

    delete: vi.fn((key) => {
      store.delete(key);
    }),

    has: vi.fn((key) => {
      return store.has(key);
    }),

    clear: vi.fn(() => {
      store.clear();
    }),

    // Helpers
    __reset: () => store.clear(),
    __set: (key, value) => store.set(key, value),
    __get: (key) => store.get(key),
    __getAll: () => Object.fromEntries(store)
  };
}

/**
 * Create mock path module
 */
export function createPathMock() {
  return {
    join: vi.fn((...parts) => parts.filter(Boolean).join('/')),
    basename: vi.fn((path) => path.split('/').pop()),
    dirname: vi.fn((path) => path.split('/').slice(0, -1).join('/')),
    resolve: vi.fn((...parts) => parts.filter(Boolean).join('/')),
    sep: '/'
  };
}

/**
 * Create mock os module
 */
export function createOsMock(homedir = '/Users/testuser') {
  return {
    homedir: vi.fn(() => homedir),
    platform: vi.fn(() => 'darwin'),
    arch: vi.fn(() => 'arm64'),
    tmpdir: vi.fn(() => '/tmp')
  };
}

/**
 * Create mock dialog module (Electron)
 */
export function createDialogMock() {
  return {
    showOpenDialog: vi.fn(async (window, options) => {
      return { canceled: false, filePaths: ['/selected/path'] };
    }),

    showSaveDialog: vi.fn(async (window, options) => {
      return { canceled: false, filePath: '/saved/path' };
    }),

    showMessageBox: vi.fn(async (window, options) => {
      return { response: 0 };
    })
  };
}

/**
 * Create mock database module
 */
export function createDatabaseMock() {
  let initialized = false;

  return {
    initDatabase: vi.fn(async (path) => {
      initialized = true;
      return true;
    }),

    closeDatabase: vi.fn(() => {
      initialized = false;
    }),

    getStats: vi.fn(() => ({
      total: 10,
      unread: 5,
      reading: 2,
      read: 3
    })),

    getAllPapers: vi.fn(() => []),
    getPaper: vi.fn((id) => null),
    addPaper: vi.fn((paper) => ({ id: 1, ...paper })),
    updatePaper: vi.fn((id, updates) => true),
    deletePaper: vi.fn((id) => true),

    // Helpers
    __isInitialized: () => initialized,
    __reset: () => { initialized = false; }
  };
}
