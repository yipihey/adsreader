/**
 * Unit Tests for mobile-database.js
 * Tests the SQLite database operations for the iOS app
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock sql.js
const mockStatement = {
  run: vi.fn(),
  bind: vi.fn(),
  step: vi.fn(),
  getAsObject: vi.fn(),
  free: vi.fn()
};

const mockDatabase = {
  run: vi.fn(),
  exec: vi.fn(() => [{ values: [[0]] }]),
  export: vi.fn(() => new Uint8Array([1, 2, 3])),
  close: vi.fn(),
  prepare: vi.fn(() => mockStatement)
};

// Create a proper constructor function that returns mockDatabase
function MockDatabaseConstructor() {
  return mockDatabase;
}

// The SQL object returned by initSqlJs
const mockSQL = {
  Database: MockDatabaseConstructor
};

vi.mock('sql.js', () => ({
  default: vi.fn(async () => mockSQL)
}));

// Mock Capacitor Filesystem
const mockFilesystemStorage = new Map();

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    readFile: vi.fn(async ({ path, directory }) => {
      const key = `${directory}:${path}`;
      if (!mockFilesystemStorage.has(key)) {
        throw new Error(`File does not exist: ${path}`);
      }
      return { data: mockFilesystemStorage.get(key) };
    }),
    writeFile: vi.fn(async ({ path, directory, data }) => {
      const key = `${directory}:${path}`;
      mockFilesystemStorage.set(key, data);
      return { uri: `file://${path}` };
    }),
    mkdir: vi.fn(async () => ({})),
    stat: vi.fn(async () => ({ type: 'file', size: 1024 }))
  },
  Directory: {
    Documents: 'DOCUMENTS',
    ICloud: 'ICLOUD'
  },
  Encoding: {
    UTF8: 'utf8'
  }
}));

// Import after mocks are set up
let mobileDb;

describe('mobile-database.js', () => {
  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    mockFilesystemStorage.clear();

    // Reset module to clear db state
    vi.resetModules();
    mobileDb = await import('../../src/capacitor/mobile-database.js');
  });

  afterEach(() => {
    if (mobileDb.isInitialized()) {
      mobileDb.closeDatabase();
    }
  });

  describe('initDatabase', () => {
    it('should initialize a new database when no file exists', async () => {
      const result = await mobileDb.initDatabase('TestLibrary');

      expect(result).toBe(true);
      expect(mobileDb.isInitialized()).toBe(true);
      expect(mobileDb.getLibraryPath()).toBe('TestLibrary');
    });

    it('should load existing database from filesystem', async () => {
      // Pre-populate with fake database data
      const fakeDbData = btoa(String.fromCharCode(...new Uint8Array([1, 2, 3])));
      mockFilesystemStorage.set('DOCUMENTS:TestLibrary/library.sqlite', fakeDbData);

      const result = await mobileDb.initDatabase('TestLibrary');

      expect(result).toBe(true);
      expect(mobileDb.isInitialized()).toBe(true);
    });

    it('should create schema tables on initialization', async () => {
      await mobileDb.initDatabase('TestLibrary');

      // Verify db.run was called for schema creation
      expect(mockDatabase.run).toHaveBeenCalled();
      const calls = mockDatabase.run.mock.calls.map(c => c[0]);

      // Check that papers table creation was called
      expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS papers'))).toBe(true);
    });

    it('should set correct database path', async () => {
      await mobileDb.initDatabase('My Library');

      expect(mobileDb.getLibraryPath()).toBe('My Library');
    });
  });

  describe('initDatabaseFromICloud', () => {
    it('should initialize database from iCloud directory', async () => {
      const result = await mobileDb.initDatabaseFromICloud('iCloudLibrary');

      expect(result).toBe(true);
      expect(mobileDb.isInitialized()).toBe(true);
      expect(mobileDb.getLibraryPath()).toBe('iCloudLibrary');
    });

    it('should use iCloud directory constant', async () => {
      const { Filesystem } = await import('@capacitor/filesystem');

      await mobileDb.initDatabaseFromICloud('iCloudLibrary');

      // Check that writeFile was called with ICloud directory
      expect(Filesystem.writeFile).toHaveBeenCalledWith(
        expect.objectContaining({
          directory: 'ICLOUD'
        })
      );
    });
  });

  describe('saveDatabase', () => {
    it('should save database to filesystem', async () => {
      const { Filesystem } = await import('@capacitor/filesystem');
      await mobileDb.initDatabase('TestLibrary');

      await mobileDb.saveDatabase();

      expect(Filesystem.writeFile).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'TestLibrary/library.sqlite',
          directory: 'DOCUMENTS'
        })
      );
    });

    it('should not save when database is not initialized', async () => {
      const { Filesystem } = await import('@capacitor/filesystem');
      vi.clearAllMocks();

      await mobileDb.saveDatabase();

      expect(Filesystem.writeFile).not.toHaveBeenCalled();
    });

    it('should export database as base64', async () => {
      await mobileDb.initDatabase('TestLibrary');
      vi.clearAllMocks();

      await mobileDb.saveDatabase();

      expect(mockDatabase.export).toHaveBeenCalled();
    });
  });

  describe('closeDatabase', () => {
    it('should close the database', async () => {
      await mobileDb.initDatabase('TestLibrary');
      expect(mobileDb.isInitialized()).toBe(true);

      mobileDb.closeDatabase();

      expect(mockDatabase.close).toHaveBeenCalled();
    });

    it('should handle closing when not initialized', () => {
      // Should not throw
      expect(() => mobileDb.closeDatabase()).not.toThrow();
    });
  });

  describe('addPaper', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
      mockDatabase.exec.mockReturnValue([{ values: [[1]] }]);
    });

    it('should add a paper and return ID', () => {
      const paper = {
        bibcode: '2024Test.....1A',
        title: 'Test Paper',
        authors: ['Author One', 'Author Two'],
        year: 2024
      };

      const id = mobileDb.addPaper(paper);

      expect(id).toBe(1);
      expect(mockDatabase.prepare).toHaveBeenCalled();
    });

    it('should use default values for missing fields', () => {
      const paper = {};

      mobileDb.addPaper(paper);

      expect(mockStatement.run).toHaveBeenCalledWith(
        expect.arrayContaining([
          null, // bibcode
          null, // doi
          null, // arxiv_id
          'Untitled', // title default
          '[]', // authors JSON
          null, // year
          null, // journal
          null, // abstract
          '[]', // keywords JSON
        ])
      );
    });

    it('should JSON stringify authors array', () => {
      const paper = {
        authors: ['First Author', 'Second Author']
      };

      mobileDb.addPaper(paper);

      const runCall = mockStatement.run.mock.calls[0][0];
      expect(runCall).toContain('["First Author","Second Author"]');
    });

    it('should set added_date and modified_date', () => {
      const before = new Date().toISOString();

      mobileDb.addPaper({ title: 'Test' });

      const runCall = mockStatement.run.mock.calls[0][0];
      // Check that ISO date strings are included
      expect(runCall.some(v => typeof v === 'string' && v.includes('T'))).toBe(true);
    });
  });

  describe('getPaper', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
    });

    it('should return paper when found', () => {
      mockStatement.step.mockReturnValueOnce(true);
      mockStatement.getAsObject.mockReturnValueOnce({
        id: 1,
        bibcode: '2024Test.....1A',
        title: 'Test Paper',
        authors: '["Author One"]',
        keywords: '[]',
        year: 2024,
        read_status: 'unread',
        rating: 0
      });

      const paper = mobileDb.getPaper(1);

      expect(paper).not.toBeNull();
      expect(paper.id).toBe(1);
      expect(paper.bibcode).toBe('2024Test.....1A');
      expect(paper.authors).toEqual(['Author One']);
    });

    it('should return null when paper not found', () => {
      mockStatement.step.mockReturnValueOnce(false);

      const paper = mobileDb.getPaper(999);

      expect(paper).toBeNull();
    });

    it('should parse JSON fields correctly', () => {
      mockStatement.step.mockReturnValueOnce(true);
      mockStatement.getAsObject.mockReturnValueOnce({
        id: 1,
        authors: '["A", "B", "C"]',
        keywords: '["physics", "astronomy"]'
      });

      const paper = mobileDb.getPaper(1);

      expect(paper.authors).toEqual(['A', 'B', 'C']);
      expect(paper.keywords).toEqual(['physics', 'astronomy']);
    });

    it('should handle null JSON fields', () => {
      mockStatement.step.mockReturnValueOnce(true);
      mockStatement.getAsObject.mockReturnValueOnce({
        id: 1,
        authors: null,
        keywords: null
      });

      const paper = mobileDb.getPaper(1);

      expect(paper.authors).toEqual([]);
      expect(paper.keywords).toEqual([]);
    });
  });

  describe('getPaperByBibcode', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
    });

    it('should find paper by bibcode', () => {
      mockStatement.step.mockReturnValueOnce(true);
      mockStatement.getAsObject.mockReturnValueOnce({
        id: 1,
        bibcode: '2024Test.....1A',
        title: 'Found Paper',
        authors: '[]',
        keywords: '[]'
      });

      const paper = mobileDb.getPaperByBibcode('2024Test.....1A');

      expect(paper).not.toBeNull();
      expect(paper.bibcode).toBe('2024Test.....1A');
      expect(mockStatement.bind).toHaveBeenCalledWith(['2024Test.....1A']);
    });

    it('should return null for unknown bibcode', () => {
      mockStatement.step.mockReturnValueOnce(false);

      const paper = mobileDb.getPaperByBibcode('unknown');

      expect(paper).toBeNull();
    });
  });

  describe('getAllPapers', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
    });

    it('should return all papers', () => {
      mockStatement.step
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      mockStatement.getAsObject
        .mockReturnValueOnce({ id: 1, title: 'Paper 1', authors: '[]', keywords: '[]' })
        .mockReturnValueOnce({ id: 2, title: 'Paper 2', authors: '[]', keywords: '[]' });

      const papers = mobileDb.getAllPapers();

      expect(papers).toHaveLength(2);
      expect(papers[0].title).toBe('Paper 1');
      expect(papers[1].title).toBe('Paper 2');
    });

    it('should filter by read status', () => {
      mockStatement.step.mockReturnValueOnce(false);

      mobileDb.getAllPapers({ readStatus: 'unread' });

      const prepareCall = mockDatabase.prepare.mock.calls.slice(-1)[0][0];
      expect(prepareCall).toContain('read_status = ?');
    });

    it('should filter by collection', () => {
      mockStatement.step.mockReturnValueOnce(false);

      mobileDb.getAllPapers({ collectionId: 5 });

      const prepareCall = mockDatabase.prepare.mock.calls.slice(-1)[0][0];
      expect(prepareCall).toContain('paper_collections');
      expect(prepareCall).toContain('collection_id');
    });

    it('should search across title, authors, abstract', () => {
      mockStatement.step.mockReturnValueOnce(false);

      mobileDb.getAllPapers({ search: 'quantum' });

      const prepareCall = mockDatabase.prepare.mock.calls.slice(-1)[0][0];
      expect(prepareCall).toContain('title LIKE ?');
      expect(prepareCall).toContain('authors LIKE ?');
      expect(prepareCall).toContain('abstract LIKE ?');
    });

    it('should order by specified field', () => {
      mockStatement.step.mockReturnValueOnce(false);

      mobileDb.getAllPapers({ orderBy: 'year', order: 'ASC' });

      const prepareCall = mockDatabase.prepare.mock.calls.slice(-1)[0][0];
      expect(prepareCall).toContain('ORDER BY year ASC');
    });

    it('should apply limit', () => {
      mockStatement.step.mockReturnValueOnce(false);

      mobileDb.getAllPapers({ limit: 10 });

      const prepareCall = mockDatabase.prepare.mock.calls.slice(-1)[0][0];
      expect(prepareCall).toContain('LIMIT ?');
    });

    it('should use default order by added_date DESC', () => {
      mockStatement.step.mockReturnValueOnce(false);

      mobileDb.getAllPapers({});

      const prepareCall = mockDatabase.prepare.mock.calls.slice(-1)[0][0];
      expect(prepareCall).toContain('ORDER BY added_date DESC');
    });
  });

  describe('updatePaper', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
    });

    it('should update paper fields', () => {
      const result = mobileDb.updatePaper(1, {
        title: 'Updated Title',
        rating: 3
      });

      expect(result).toBe(true);
      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE papers SET'),
        expect.any(Array)
      );
    });

    it('should not update id field', () => {
      mobileDb.updatePaper(1, {
        id: 999,
        title: 'New Title'
      });

      const [sql] = mockDatabase.run.mock.calls.slice(-1)[0];
      // The SET clause should not contain 'id =' - only title and modified_date
      // But WHERE clause will have 'id =' which is correct
      const setClause = sql.split('SET')[1].split('WHERE')[0];
      expect(setClause).not.toContain('id =');
    });

    it('should JSON stringify authors on update', () => {
      mobileDb.updatePaper(1, {
        authors: ['New Author']
      });

      const [, values] = mockDatabase.run.mock.calls.slice(-1)[0];
      expect(values).toContain('["New Author"]');
    });

    it('should return false when no fields to update', () => {
      const result = mobileDb.updatePaper(1, {});

      expect(result).toBe(false);
    });

    it('should update modified_date', () => {
      mobileDb.updatePaper(1, { title: 'Test' });

      const [sql] = mockDatabase.run.mock.calls.slice(-1)[0];
      expect(sql).toContain('modified_date = ?');
    });
  });

  describe('deletePaper', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
    });

    it('should delete paper and related records', () => {
      const result = mobileDb.deletePaper(1);

      expect(result).toBe(true);

      // Check all related tables are cleaned up
      const deleteCalls = mockDatabase.run.mock.calls.filter(c => c[0].includes('DELETE'));
      const tables = deleteCalls.map(c => c[0]);

      expect(tables.some(sql => sql.includes('refs'))).toBe(true);
      expect(tables.some(sql => sql.includes('citations'))).toBe(true);
      expect(tables.some(sql => sql.includes('paper_collections'))).toBe(true);
      expect(tables.some(sql => sql.includes('annotations'))).toBe(true);
      expect(tables.some(sql => sql.includes('paper_summaries'))).toBe(true);
      expect(tables.some(sql => sql.includes('paper_qa'))).toBe(true);
      expect(tables.some(sql => sql.includes('text_embeddings'))).toBe(true);
      expect(tables.some(sql => sql.includes('FROM papers'))).toBe(true);
    });
  });

  describe('getCollections', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
    });

    it('should return collections with paper counts', () => {
      mockDatabase.exec.mockReturnValueOnce([{
        values: [
          [1, 'Physics', null, 0, null, '2024-01-01', 5],
          [2, 'Astronomy', 1, 0, null, '2024-01-02', 3]
        ]
      }]);

      const collections = mobileDb.getCollections();

      expect(collections).toHaveLength(2);
      expect(collections[0].name).toBe('Physics');
      expect(collections[0].paper_count).toBe(5);
      expect(collections[1].parent_id).toBe(1);
    });

    it('should return empty array when no collections', () => {
      mockDatabase.exec.mockReturnValueOnce([]);

      const collections = mobileDb.getCollections();

      expect(collections).toEqual([]);
    });

    it('should convert is_smart to boolean', () => {
      mockDatabase.exec.mockReturnValueOnce([{
        values: [
          [1, 'Smart Collection', null, 1, 'year:2024', '2024-01-01', 0]
        ]
      }]);

      const collections = mobileDb.getCollections();

      expect(collections[0].is_smart).toBe(true);
    });
  });

  describe('createCollection', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
      mockDatabase.exec.mockReturnValue([{ values: [[5]] }]);
    });

    it('should create collection and return ID', () => {
      const id = mobileDb.createCollection('New Collection');

      expect(id).toBe(5);
      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO collections'),
        expect.arrayContaining(['New Collection', null])
      );
    });

    it('should create nested collection with parent', () => {
      mobileDb.createCollection('Child Collection', 1);

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO collections'),
        expect.arrayContaining(['Child Collection', 1])
      );
    });
  });

  describe('addPaperToCollection', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
    });

    it('should add paper to collection', () => {
      mobileDb.addPaperToCollection(1, 2);

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR IGNORE INTO paper_collections'),
        [1, 2]
      );
    });
  });

  describe('removePaperFromCollection', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
    });

    it('should remove paper from collection', () => {
      mobileDb.removePaperFromCollection(1, 2);

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM paper_collections'),
        [1, 2]
      );
    });
  });

  describe('getAnnotations', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
    });

    it('should return annotations for paper', () => {
      mockStatement.step
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      mockStatement.getAsObject.mockReturnValueOnce({
        id: 1,
        paper_id: 1,
        page_number: 5,
        selection_text: 'highlighted text',
        selection_rects: '[{"x":0,"y":0}]',
        note_content: 'my note',
        color: '#ffeb3b',
        pdf_source: 'EPRINT_PDF',
        created_at: '2024-01-01',
        updated_at: '2024-01-01'
      });

      const annotations = mobileDb.getAnnotations(1);

      expect(annotations).toHaveLength(1);
      expect(annotations[0].selection_text).toBe('highlighted text');
      expect(annotations[0].selection_rects).toEqual([{ x: 0, y: 0 }]);
    });

    it('should filter by pdf_source when provided', () => {
      mockStatement.step.mockReturnValueOnce(false);

      mobileDb.getAnnotations(1, 'EPRINT_PDF');

      const prepareCall = mockDatabase.prepare.mock.calls.slice(-1)[0][0];
      expect(prepareCall).toContain('pdf_source = ?');
    });

    it('should handle null selection_rects', () => {
      mockStatement.step
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      mockStatement.getAsObject.mockReturnValueOnce({
        id: 1,
        selection_rects: null
      });

      const annotations = mobileDb.getAnnotations(1);

      expect(annotations[0].selection_rects).toEqual([]);
    });
  });

  describe('addAnnotation', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
      mockDatabase.exec.mockReturnValue([{ values: [[10]] }]);
    });

    it('should add annotation and return ID', () => {
      const annotation = {
        paper_id: 1,
        page_number: 3,
        selection_text: 'important text',
        selection_rects: [{ x: 10, y: 20 }],
        note_content: 'my note',
        color: '#ff0000',
        pdf_source: 'EPRINT_PDF'
      };

      const id = mobileDb.addAnnotation(annotation);

      expect(id).toBe(10);
    });

    it('should use default values for optional fields', () => {
      mobileDb.addAnnotation({
        paper_id: 1,
        page_number: 1,
        selection_text: 'text'
      });

      const runCall = mockDatabase.run.mock.calls.slice(-1)[0];
      const values = runCall[1];

      // Default color
      expect(values).toContain('#ffeb3b');
      // Empty note
      expect(values).toContain('');
      // Empty selection_rects JSON
      expect(values).toContain('[]');
    });
  });

  describe('deleteAnnotation', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
    });

    it('should delete annotation by ID', () => {
      mobileDb.deleteAnnotation(5);

      expect(mockDatabase.run).toHaveBeenCalledWith(
        'DELETE FROM annotations WHERE id = ?',
        [5]
      );
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      await mobileDb.initDatabase('TestLibrary');
    });

    it('should return library statistics', () => {
      mockDatabase.exec
        .mockReturnValueOnce([{ values: [[100]] }])  // total
        .mockReturnValueOnce([{ values: [[50]] }])   // unread
        .mockReturnValueOnce([{ values: [[30]] }])   // reading
        .mockReturnValueOnce([{ values: [[20]] }]);  // read

      const stats = mobileDb.getStats();

      expect(stats.total).toBe(100);
      expect(stats.unread).toBe(50);
      expect(stats.reading).toBe(30);
      expect(stats.read).toBe(20);
    });

    it('should return zeros when database not initialized', async () => {
      mobileDb.closeDatabase();
      vi.resetModules();
      mobileDb = await import('../../src/capacitor/mobile-database.js');

      const stats = mobileDb.getStats();

      expect(stats).toEqual({ total: 0, unread: 0, reading: 0, read: 0 });
    });

    it('should handle query errors gracefully', () => {
      mockDatabase.exec.mockImplementation(() => {
        throw new Error('Query failed');
      });

      const stats = mobileDb.getStats();

      expect(stats).toEqual({ total: 0, unread: 0, reading: 0, read: 0 });
    });
  });

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      expect(mobileDb.isInitialized()).toBe(false);
    });

    it('should return true after initialization', async () => {
      await mobileDb.initDatabase('TestLibrary');

      expect(mobileDb.isInitialized()).toBe(true);
    });

    it('should return false after closing', async () => {
      await mobileDb.initDatabase('TestLibrary');
      mobileDb.closeDatabase();

      expect(mobileDb.isInitialized()).toBe(false);
    });
  });

  describe('getLibraryPath', () => {
    it('should return null before initialization', () => {
      expect(mobileDb.getLibraryPath()).toBeNull();
    });

    it('should return library path after initialization', async () => {
      await mobileDb.initDatabase('My Library');

      expect(mobileDb.getLibraryPath()).toBe('My Library');
    });
  });

  describe('schema creation', () => {
    it('should create all required tables', async () => {
      await mobileDb.initDatabase('TestLibrary');

      const runCalls = mockDatabase.run.mock.calls.map(c => c[0]);

      const requiredTables = ['papers', 'refs', 'citations', 'collections',
                             'paper_collections', 'annotations', 'paper_summaries',
                             'paper_qa', 'text_embeddings'];

      for (const table of requiredTables) {
        expect(runCalls.some(sql =>
          sql.includes('CREATE TABLE IF NOT EXISTS') && sql.includes(table)
        )).toBe(true);
      }
    });

    it('should create indexes', async () => {
      await mobileDb.initDatabase('TestLibrary');

      const runCalls = mockDatabase.run.mock.calls.map(c => c[0]);

      expect(runCalls.some(sql => sql.includes('CREATE INDEX'))).toBe(true);
    });

    it('should run migrations for new columns', async () => {
      await mobileDb.initDatabase('TestLibrary');

      const runCalls = mockDatabase.run.mock.calls.map(c => c[0]);

      // Should attempt to add rating column
      expect(runCalls.some(sql => sql.includes('ALTER TABLE') && sql.includes('rating'))).toBe(true);
    });
  });
});
