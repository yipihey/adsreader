/**
 * ADS Reader - Shared Constants
 * Used by both desktop (Electron) and mobile (Capacitor) platforms
 */

// ADS API Configuration
export const ADS_API_BASE = 'https://api.adsabs.harvard.edu/v1';
export const ADS_HOST = 'api.adsabs.harvard.edu';
export const ADS_BASE_PATH = '/v1';

// Default fields for ADS search queries
export const ADS_SEARCH_FIELDS = [
  'bibcode',
  'title',
  'author',
  'year',
  'doi',
  'abstract',
  'keyword',
  'pub',
  'identifier',
  'arxiv_class',
  'citation_count'
].join(',');

// Fields for metadata sync (includes references/citations)
export const ADS_METADATA_FIELDS = [
  'bibcode',
  'title',
  'author',
  'year',
  'doi',
  'abstract',
  'keyword',
  'pub',
  'identifier',
  'arxiv_class',
  'citation_count',
  'reference',
  'citation'
].join(',');

// iCloud Configuration
export const ICLOUD_CONTAINER_ID = 'iCloud.io.adsreader.app';
export const APP_BUNDLE_ID = 'io.adsreader.app';

// Library folder names
export const LIBRARY_FOLDER_NAME = 'ADSReader';
export const LIBRARIES_JSON = 'libraries.json';

// PDF source types (in priority order by default)
export const PDF_SOURCE_TYPES = {
  ARXIV: 'EPRINT_PDF',
  PUBLISHER: 'PUB_PDF',
  ADS_SCAN: 'ADS_PDF'
};

export const DEFAULT_PDF_PRIORITY = ['EPRINT_PDF', 'PUB_PDF', 'ADS_PDF'];

// Source type labels for UI
export const PDF_SOURCE_LABELS = {
  'EPRINT_PDF': 'arXiv',
  'PUB_PDF': 'Publisher',
  'ADS_PDF': 'ADS Scan'
};

// Database table names
export const DB_TABLES = {
  PAPERS: 'papers',
  REFS: 'refs',
  CITATIONS: 'citations',
  COLLECTIONS: 'collections',
  PAPER_COLLECTIONS: 'paper_collections',
  ANNOTATIONS: 'annotations',
  PAPER_SUMMARIES: 'paper_summaries',
  PAPER_QA: 'paper_qa',
  TEXT_EMBEDDINGS: 'text_embeddings'
};

// Read status values
export const READ_STATUS = {
  UNREAD: 'unread',
  READING: 'reading',
  READ: 'read'
};

// Rating values (1-4 scale)
export const RATING_LABELS = {
  1: 'Seminal',
  2: 'Important',
  3: 'Useful',
  4: 'Meh'
};
