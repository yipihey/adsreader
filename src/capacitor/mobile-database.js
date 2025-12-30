/**
 * ADS Reader - Mobile Database Module (sql.js + Capacitor Filesystem)
 * SQLite database using sql.js with Capacitor Filesystem for persistence
 *
 * This module provides the same interface as the desktop database.cjs
 * but uses Capacitor's Filesystem API instead of Node.js fs.
 */

import initSqlJs from 'sql.js';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

let db = null;
let dbPath = null;
let libraryPath = null;
let SQL = null;

// sql.js WASM file URL - loaded from CDN
const SQL_WASM_URL = 'https://sql.js.org/dist/sql-wasm.wasm';

/**
 * Initialize sql.js and load/create database
 * @param {string} libPath - Library folder path (relative to Documents)
 * @returns {Promise<boolean>}
 */
export async function initDatabase(libPath) {
  libraryPath = libPath;
  dbPath = `${libPath}/library.sqlite`;

  if (!SQL) {
    // Initialize sql.js with WASM
    SQL = await initSqlJs({
      locateFile: file => SQL_WASM_URL
    });
  }

  // Try to load existing database
  try {
    const result = await Filesystem.readFile({
      path: dbPath,
      directory: Directory.Documents
    });

    // Convert base64 to Uint8Array
    const binaryString = atob(result.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    db = new SQL.Database(bytes);
    console.log('[MobileDB] Loaded existing database');
  } catch (e) {
    // Database doesn't exist, create new one
    db = new SQL.Database();
    console.log('[MobileDB] Created new database');
  }

  // Ensure schema exists
  createSchema();
  await saveDatabase();

  return true;
}

/**
 * Save database to filesystem
 */
export async function saveDatabase() {
  if (!db || !dbPath) return;

  try {
    const data = db.export();
    const uint8Array = new Uint8Array(data);

    // Convert to base64 for Capacitor Filesystem
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);

    await Filesystem.writeFile({
      path: dbPath,
      directory: Directory.Documents,
      data: base64
    });

    console.log('[MobileDB] Database saved');
  } catch (e) {
    console.error('[MobileDB] Failed to save database:', e);
  }
}

/**
 * Close database
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Create database schema
 */
function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bibcode TEXT UNIQUE,
      doi TEXT,
      arxiv_id TEXT,
      title TEXT,
      authors TEXT,
      year INTEGER,
      journal TEXT,
      abstract TEXT,
      keywords TEXT,
      pdf_path TEXT,
      text_path TEXT,
      bibtex TEXT,
      read_status TEXT DEFAULT 'unread',
      rating INTEGER DEFAULT 0,
      added_date TEXT,
      modified_date TEXT,
      import_source TEXT,
      import_source_key TEXT,
      citation_count INTEGER DEFAULT 0
    )
  `);

  // Migration: Add columns if they don't exist
  const migrations = [
    'ALTER TABLE papers ADD COLUMN rating INTEGER DEFAULT 0',
    'ALTER TABLE papers ADD COLUMN import_source TEXT',
    'ALTER TABLE papers ADD COLUMN import_source_key TEXT',
    'ALTER TABLE papers ADD COLUMN citation_count INTEGER DEFAULT 0'
  ];

  for (const sql of migrations) {
    try { db.run(sql); } catch (e) { /* Column exists */ }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER,
      ref_bibcode TEXT,
      ref_title TEXT,
      ref_authors TEXT,
      ref_year INTEGER,
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS citations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER,
      citing_bibcode TEXT,
      citing_title TEXT,
      citing_authors TEXT,
      citing_year INTEGER,
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      is_smart INTEGER DEFAULT 0,
      query TEXT,
      created_date TEXT,
      FOREIGN KEY (parent_id) REFERENCES collections(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS paper_collections (
      paper_id INTEGER,
      collection_id INTEGER,
      PRIMARY KEY (paper_id, collection_id),
      FOREIGN KEY (paper_id) REFERENCES papers(id),
      FOREIGN KEY (collection_id) REFERENCES collections(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS annotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER,
      page_number INTEGER,
      selection_text TEXT,
      selection_rects TEXT,
      note_content TEXT,
      color TEXT DEFAULT '#ffeb3b',
      pdf_source TEXT,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS paper_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER UNIQUE,
      summary_text TEXT,
      model_used TEXT,
      created_at TEXT,
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS paper_qa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER,
      question TEXT,
      answer TEXT,
      created_at TEXT,
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS text_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER,
      chunk_index INTEGER,
      chunk_text TEXT,
      embedding TEXT,
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    )
  `);

  // Create indexes
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_papers_bibcode ON papers(bibcode)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_papers_added_date ON papers(added_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_refs_paper_id ON refs(paper_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_citations_paper_id ON citations(paper_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_annotations_paper_id ON annotations(paper_id)`);
  } catch (e) { /* Indexes exist */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// PAPER OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add a paper to the database
 * @param {Object} paper - Paper data
 * @returns {number} - The new paper ID
 */
export function addPaper(paper) {
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO papers (bibcode, doi, arxiv_id, title, authors, year, journal, abstract, keywords,
                        pdf_path, text_path, bibtex, read_status, rating, added_date, modified_date,
                        import_source, import_source_key, citation_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run([
    paper.bibcode || null,
    paper.doi || null,
    paper.arxiv_id || null,
    paper.title || 'Untitled',
    JSON.stringify(paper.authors || []),
    paper.year || null,
    paper.journal || null,
    paper.abstract || null,
    JSON.stringify(paper.keywords || []),
    paper.pdf_path || null,
    paper.text_path || null,
    paper.bibtex || null,
    paper.read_status || 'unread',
    paper.rating || 0,
    now,
    now,
    paper.import_source || null,
    paper.import_source_key || null,
    paper.citation_count || 0
  ]);
  stmt.free();

  const result = db.exec('SELECT last_insert_rowid()');
  return result[0].values[0][0];
}

/**
 * Get a paper by ID
 * @param {number} id - Paper ID
 * @returns {Object|null} - Paper object or null
 */
export function getPaper(id) {
  const stmt = db.prepare('SELECT * FROM papers WHERE id = ?');
  stmt.bind([id]);

  if (stmt.step()) {
    const paper = rowToPaper(stmt.getAsObject());
    stmt.free();
    return paper;
  }
  stmt.free();
  return null;
}

/**
 * Get a paper by bibcode
 * @param {string} bibcode - ADS bibcode
 * @returns {Object|null} - Paper object or null
 */
export function getPaperByBibcode(bibcode) {
  const stmt = db.prepare('SELECT * FROM papers WHERE bibcode = ?');
  stmt.bind([bibcode]);

  if (stmt.step()) {
    const paper = rowToPaper(stmt.getAsObject());
    stmt.free();
    return paper;
  }
  stmt.free();
  return null;
}

/**
 * Get all papers with optional filtering
 * @param {Object} options - Query options
 * @returns {Array} - Array of papers
 */
export function getAllPapers(options = {}) {
  let sql = 'SELECT * FROM papers WHERE 1=1';
  const params = [];

  if (options.readStatus) {
    sql += ' AND read_status = ?';
    params.push(options.readStatus);
  }

  if (options.collectionId) {
    sql += ' AND id IN (SELECT paper_id FROM paper_collections WHERE collection_id = ?)';
    params.push(options.collectionId);
  }

  if (options.search) {
    sql += ' AND (title LIKE ? OR authors LIKE ? OR abstract LIKE ?)';
    const searchTerm = `%${options.search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const orderBy = options.orderBy || 'added_date';
  const order = options.order || 'DESC';
  sql += ` ORDER BY ${orderBy} ${order}`;

  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  const stmt = db.prepare(sql);
  stmt.bind(params);

  const papers = [];
  while (stmt.step()) {
    papers.push(rowToPaper(stmt.getAsObject()));
  }
  stmt.free();

  return papers;
}

/**
 * Update a paper
 * @param {number} id - Paper ID
 * @param {Object} updates - Fields to update
 * @returns {boolean} - Success
 */
export function updatePaper(id, updates) {
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'id') continue;

    fields.push(`${key} = ?`);
    if (key === 'authors' || key === 'keywords') {
      values.push(JSON.stringify(value));
    } else {
      values.push(value);
    }
  }

  if (fields.length === 0) return false;

  fields.push('modified_date = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const sql = `UPDATE papers SET ${fields.join(', ')} WHERE id = ?`;
  db.run(sql, values);
  return true;
}

/**
 * Delete a paper
 * @param {number} id - Paper ID
 * @returns {boolean} - Success
 */
export function deletePaper(id) {
  db.run('DELETE FROM refs WHERE paper_id = ?', [id]);
  db.run('DELETE FROM citations WHERE paper_id = ?', [id]);
  db.run('DELETE FROM paper_collections WHERE paper_id = ?', [id]);
  db.run('DELETE FROM annotations WHERE paper_id = ?', [id]);
  db.run('DELETE FROM paper_summaries WHERE paper_id = ?', [id]);
  db.run('DELETE FROM paper_qa WHERE paper_id = ?', [id]);
  db.run('DELETE FROM text_embeddings WHERE paper_id = ?', [id]);
  db.run('DELETE FROM papers WHERE id = ?', [id]);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTION OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all collections
 * @returns {Array} - Array of collections
 */
export function getCollections() {
  const result = db.exec(`
    SELECT c.*,
           (SELECT COUNT(*) FROM paper_collections WHERE collection_id = c.id) as paper_count
    FROM collections c
    ORDER BY c.name
  `);

  if (!result[0]) return [];

  return result[0].values.map(row => ({
    id: row[0],
    name: row[1],
    parent_id: row[2],
    is_smart: row[3] === 1,
    query: row[4],
    created_date: row[5],
    paper_count: row[6]
  }));
}

/**
 * Create a collection
 * @param {string} name - Collection name
 * @param {number|null} parentId - Parent collection ID
 * @returns {number} - New collection ID
 */
export function createCollection(name, parentId = null) {
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO collections (name, parent_id, created_date) VALUES (?, ?, ?)',
    [name, parentId, now]
  );
  const result = db.exec('SELECT last_insert_rowid()');
  return result[0].values[0][0];
}

/**
 * Add paper to collection
 * @param {number} paperId - Paper ID
 * @param {number} collectionId - Collection ID
 */
export function addPaperToCollection(paperId, collectionId) {
  try {
    db.run(
      'INSERT OR IGNORE INTO paper_collections (paper_id, collection_id) VALUES (?, ?)',
      [paperId, collectionId]
    );
  } catch (e) {
    // Already in collection
  }
}

/**
 * Remove paper from collection
 * @param {number} paperId - Paper ID
 * @param {number} collectionId - Collection ID
 */
export function removePaperFromCollection(paperId, collectionId) {
  db.run(
    'DELETE FROM paper_collections WHERE paper_id = ? AND collection_id = ?',
    [paperId, collectionId]
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ANNOTATION OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get annotations for a paper
 * @param {number} paperId - Paper ID
 * @param {string} pdfSource - PDF source type (optional)
 * @returns {Array} - Array of annotations
 */
export function getAnnotations(paperId, pdfSource = null) {
  let sql = 'SELECT * FROM annotations WHERE paper_id = ?';
  const params = [paperId];

  if (pdfSource) {
    sql += ' AND pdf_source = ?';
    params.push(pdfSource);
  }

  sql += ' ORDER BY page_number, id';

  const stmt = db.prepare(sql);
  stmt.bind(params);

  const annotations = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    annotations.push({
      id: row.id,
      paper_id: row.paper_id,
      page_number: row.page_number,
      selection_text: row.selection_text,
      selection_rects: row.selection_rects ? JSON.parse(row.selection_rects) : [],
      note_content: row.note_content,
      color: row.color,
      pdf_source: row.pdf_source,
      created_at: row.created_at,
      updated_at: row.updated_at
    });
  }
  stmt.free();

  return annotations;
}

/**
 * Add annotation
 * @param {Object} annotation - Annotation data
 * @returns {number} - New annotation ID
 */
export function addAnnotation(annotation) {
  const now = new Date().toISOString();
  db.run(`
    INSERT INTO annotations (paper_id, page_number, selection_text, selection_rects,
                            note_content, color, pdf_source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    annotation.paper_id,
    annotation.page_number,
    annotation.selection_text,
    JSON.stringify(annotation.selection_rects || []),
    annotation.note_content || '',
    annotation.color || '#ffeb3b',
    annotation.pdf_source || null,
    now,
    now
  ]);

  const result = db.exec('SELECT last_insert_rowid()');
  return result[0].values[0][0];
}

/**
 * Delete annotation
 * @param {number} id - Annotation ID
 */
export function deleteAnnotation(id) {
  db.run('DELETE FROM annotations WHERE id = ?', [id]);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert database row to paper object
 */
function rowToPaper(row) {
  return {
    id: row.id,
    bibcode: row.bibcode,
    doi: row.doi,
    arxiv_id: row.arxiv_id,
    title: row.title,
    authors: row.authors ? JSON.parse(row.authors) : [],
    year: row.year,
    journal: row.journal,
    abstract: row.abstract,
    keywords: row.keywords ? JSON.parse(row.keywords) : [],
    pdf_path: row.pdf_path,
    text_path: row.text_path,
    bibtex: row.bibtex,
    read_status: row.read_status,
    rating: row.rating,
    added_date: row.added_date,
    modified_date: row.modified_date,
    import_source: row.import_source,
    import_source_key: row.import_source_key,
    citation_count: row.citation_count || 0
  };
}

/**
 * Check if database is initialized
 * @returns {boolean}
 */
export function isInitialized() {
  return db !== null;
}

/**
 * Get current library path
 * @returns {string|null}
 */
export function getLibraryPath() {
  return libraryPath;
}

/**
 * Get library statistics
 * @returns {Object} Stats with total, unread, reading, read counts
 */
export function getStats() {
  if (!db) return { total: 0, unread: 0, reading: 0, read: 0 };

  try {
    const total = db.exec('SELECT COUNT(*) FROM papers')[0]?.values[0][0] || 0;
    const unread = db.exec("SELECT COUNT(*) FROM papers WHERE read_status = 'unread'")[0]?.values[0][0] || 0;
    const reading = db.exec("SELECT COUNT(*) FROM papers WHERE read_status = 'reading'")[0]?.values[0][0] || 0;
    const read = db.exec("SELECT COUNT(*) FROM papers WHERE read_status = 'read'")[0]?.values[0][0] || 0;

    return { total, unread, reading, read };
  } catch (e) {
    console.error('[MobileDB] Failed to get stats:', e);
    return { total: 0, unread: 0, reading: 0, read: 0 };
  }
}

/**
 * Initialize database from iCloud
 * @param {string} libPath - Library folder path (relative to iCloud container)
 * @returns {Promise<boolean>}
 */
export async function initDatabaseFromICloud(libPath) {
  libraryPath = libPath;
  dbPath = `${libPath}/library.sqlite`;

  if (!SQL) {
    // Initialize sql.js with WASM
    SQL = await initSqlJs({
      locateFile: file => SQL_WASM_URL
    });
  }

  // Try to load existing database from iCloud
  try {
    const result = await Filesystem.readFile({
      path: dbPath,
      directory: Directory.ICloud
    });

    // Convert base64 to Uint8Array
    const binaryString = atob(result.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    db = new SQL.Database(bytes);
    console.log('[MobileDB] Loaded database from iCloud');
  } catch (e) {
    // Database doesn't exist, create new one
    db = new SQL.Database();
    console.log('[MobileDB] Created new database in iCloud');
  }

  // Ensure schema exists
  createSchema();
  await saveDatabaseToICloud();

  return true;
}

/**
 * Save database to iCloud filesystem
 */
async function saveDatabaseToICloud() {
  if (!db || !dbPath) return;

  try {
    const data = db.export();
    const uint8Array = new Uint8Array(data);

    // Convert to base64 for Capacitor Filesystem
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);

    await Filesystem.writeFile({
      path: dbPath,
      directory: Directory.ICloud,
      data: base64
    });
  } catch (e) {
    console.error('[MobileDB] Failed to save database to iCloud:', e);
  }
}
