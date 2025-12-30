/**
 * Vitest Global Setup
 * Runs before all tests to configure the test environment
 */

import { vi, beforeEach } from 'vitest';

// Mock console methods to reduce noise during tests
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock crypto.randomUUID for consistent test IDs
if (!global.crypto) {
  global.crypto = {
    randomUUID: () => 'test-uuid-1234-5678-9abc-def012345678'
  };
}

// Helper to reset all mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

// Global test utilities
global.testUtils = {
  // Create a mock paper object
  createMockPaper: (overrides = {}) => ({
    id: 1,
    bibcode: '2024Test.....1A',
    title: 'Test Paper Title',
    authors: 'Test Author; Another Author',
    year: 2024,
    journal: 'Test Journal',
    abstract: 'This is a test abstract.',
    doi: '10.1234/test',
    arxiv_id: '2401.00001',
    pdf_path: 'papers/2024Test.....1A_EPRINT_PDF.pdf',
    read_status: 'unread',
    rating: 0,
    added_date: '2024-01-01T00:00:00.000Z',
    citation_count: 0,
    ...overrides
  }),

  // Create a mock library object
  createMockLibrary: (overrides = {}) => ({
    id: 'lib-uuid-1234',
    name: 'Test Library',
    path: 'Test Library',
    fullPath: '/path/to/Test Library',
    location: 'icloud',
    exists: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    createdOn: 'macOS',
    ...overrides
  }),

  // Create mock libraries.json content
  createMockLibrariesJson: (libraries = []) => ({
    version: 1,
    libraries: libraries.length ? libraries : [
      {
        id: 'lib-1',
        name: 'Library One',
        path: 'Library One',
        createdAt: '2024-01-01T00:00:00.000Z',
        createdOn: 'macOS'
      }
    ]
  }),

  // Wait for async operations
  flushPromises: () => new Promise(resolve => setTimeout(resolve, 0))
};
