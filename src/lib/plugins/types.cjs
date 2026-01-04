/**
 * Plugin System Type Definitions
 *
 * This module defines the interfaces for academic paper source plugins.
 * Plugins provide search, metadata retrieval, and PDF download capabilities
 * for different academic databases (ADS, arXiv, INSPIRE, etc.)
 */

'use strict';

// ============================================================================
// Core Types
// ============================================================================

/**
 * @typedef {Object} Paper
 * @property {string} [id] - Internal database ID (set after import)
 * @property {string} [bibcode] - ADS bibcode (primary for ADS)
 * @property {string} [arxivId] - arXiv identifier (e.g., "2401.12345")
 * @property {string} [doi] - Digital Object Identifier
 * @property {string} [inspireId] - INSPIRE record ID
 * @property {string} title - Paper title
 * @property {string[]} authors - List of author names
 * @property {number} [year] - Publication year
 * @property {string} [journal] - Journal name
 * @property {string} [abstract] - Paper abstract
 * @property {string[]} [keywords] - Keywords/tags
 * @property {number} [citationCount] - Number of citations
 * @property {string} [bibtex] - BibTeX entry
 * @property {string} source - Plugin ID that provided this paper ('ads', 'arxiv', etc.)
 * @property {string} sourceId - Primary identifier in the source system
 */

/**
 * @typedef {Object} PdfSource
 * @property {string} type - Source type: 'arxiv', 'publisher', 'ads_scan', 'author', 'open_access'
 * @property {string} url - Direct or derived URL for PDF
 * @property {string} label - Human-readable label (e.g., "arXiv", "Publisher PDF")
 * @property {boolean} [requiresAuth] - Whether institutional auth is needed
 * @property {number} [priority] - Download priority (lower = preferred)
 */

/**
 * @typedef {Object} SearchResult
 * @property {Paper[]} papers - List of matching papers
 * @property {number} totalResults - Total number of results available
 * @property {string} [nextCursor] - Cursor for pagination (if supported)
 * @property {Object} [metadata] - Additional search metadata
 */

// ============================================================================
// Query Types
// ============================================================================

/**
 * Unified query format that works across all sources.
 * Plugins translate this to their native query syntax.
 *
 * @typedef {Object} UnifiedQuery
 * @property {string} [raw] - Raw query string (passed directly to source)
 * @property {string} [title] - Search in title field
 * @property {string} [author] - Search by author name
 * @property {string} [abstract] - Search in abstract
 * @property {string} [fullText] - Full-text search (if supported)
 * @property {number|[number,number]} [year] - Year or year range [start, end]
 * @property {string} [doi] - Exact DOI lookup
 * @property {string} [arxivId] - Exact arXiv ID lookup
 * @property {string} [bibcode] - Exact bibcode lookup (ADS)
 * @property {string[]} [keywords] - Keyword filter
 * @property {'date'|'citations'|'relevance'} [sort] - Sort order
 * @property {'asc'|'desc'} [sortDirection] - Sort direction (default: desc)
 * @property {number} [limit] - Maximum results to return (default: 25)
 * @property {number} [offset] - Skip first N results (for pagination)
 */

/**
 * Describes what query features a plugin supports.
 *
 * @typedef {Object} SearchCapabilities
 * @property {boolean} supportsFullText - Can search paper full text
 * @property {boolean} supportsReferences - Can retrieve paper references
 * @property {boolean} supportsCitations - Can retrieve citing papers
 * @property {boolean} supportsDateRange - Can filter by year range
 * @property {boolean} supportsBooleanOperators - Supports AND/OR/NOT
 * @property {boolean} supportsFieldSearch - Supports field-specific search
 * @property {number} maxResults - Maximum results per query
 * @property {string} queryLanguage - Native query language ('ads', 'arxiv', 'inspire', 'generic')
 * @property {string[]} sortOptions - Available sort options
 */

// ============================================================================
// Plugin Capabilities
// ============================================================================

/**
 * @typedef {Object} PluginCapabilities
 * @property {boolean} search - Can search for papers
 * @property {boolean} lookup - Can lookup by identifier
 * @property {boolean} references - Can get paper references
 * @property {boolean} citations - Can get citing papers
 * @property {boolean} pdfDownload - Can download PDFs
 * @property {boolean} bibtex - Can export BibTeX
 * @property {boolean} metadata - Can enrich paper metadata
 */

/**
 * @typedef {Object} RateLimitStatus
 * @property {number} remaining - Requests remaining in current window
 * @property {number} limit - Total requests allowed per window
 * @property {number} resetAt - Timestamp when limit resets (ms since epoch)
 * @property {number} [retryAfter] - Seconds to wait if rate limited
 */

/**
 * @typedef {Object} AuthConfig
 * @property {string} type - Auth type: 'api_key', 'oauth', 'none'
 * @property {string} [tokenKey] - Settings key where token is stored
 * @property {string} [description] - User-facing description
 * @property {string} [helpUrl] - URL for getting credentials
 */

// ============================================================================
// Plugin Interface
// ============================================================================

/**
 * @typedef {Object} SourcePlugin
 * @property {string} id - Unique plugin identifier ('ads', 'arxiv', 'inspire')
 * @property {string} name - Human-readable name ('NASA ADS', 'arXiv')
 * @property {string} [icon] - Icon (emoji or path to SVG)
 * @property {string} [description] - Short description of the source
 * @property {string} [homepage] - URL to the service homepage
 *
 * @property {PluginCapabilities} capabilities - What this plugin can do
 * @property {SearchCapabilities} searchCapabilities - Search feature details
 * @property {AuthConfig} auth - Authentication requirements
 *
 * @property {function(): Promise<boolean>} validateAuth - Check if auth is valid
 * @property {function(): RateLimitStatus} getRateLimitStatus - Get current rate limit
 *
 * @property {function(UnifiedQuery): Promise<SearchResult>} search - Search for papers
 * @property {function(string): string} translateQuery - Convert unified to native query
 *
 * @property {function(string): Promise<Paper|null>} getRecord - Get paper by source ID
 * @property {function(string): Promise<Paper|null>} [getByDOI] - Lookup by DOI
 * @property {function(string): Promise<Paper|null>} [getByArxiv] - Lookup by arXiv ID
 * @property {function(string[]): Promise<Paper[]>} [getBatch] - Batch lookup
 *
 * @property {function(string): Promise<Paper[]>} [getReferences] - Get paper references
 * @property {function(string): Promise<Paper[]>} [getCitations] - Get citing papers
 *
 * @property {function(string): Promise<PdfSource[]>} getPdfSources - Get available PDFs
 * @property {function(PdfSource, Object): Promise<Buffer>} downloadPdf - Download PDF
 *
 * @property {function(string): Promise<string>} [getBibtex] - Get BibTeX for paper
 * @property {function(string[]): Promise<Map<string,string>>} [getBibtexBatch] - Batch BibTeX
 *
 * @property {function(): Promise<void>} [initialize] - Called when plugin is loaded
 * @property {function(): Promise<void>} [shutdown] - Called when plugin is unloaded
 */

// ============================================================================
// Plugin Registry Entry
// ============================================================================

/**
 * @typedef {Object} PluginRegistration
 * @property {string} id - Plugin ID
 * @property {SourcePlugin} plugin - The plugin instance
 * @property {boolean} enabled - Whether plugin is currently enabled
 * @property {Date} registeredAt - When plugin was registered
 */

// ============================================================================
// Events
// ============================================================================

/**
 * @typedef {Object} PluginEvent
 * @property {string} type - Event type
 * @property {string} pluginId - Source plugin ID
 * @property {Object} [data] - Event-specific data
 */

// ============================================================================
// Factory & Helpers
// ============================================================================

/**
 * Create a base Paper object with required fields
 * @param {Partial<Paper>} data - Paper data
 * @param {string} source - Plugin ID
 * @param {string} sourceId - ID in source system
 * @returns {Paper}
 */
function createPaper(data, source, sourceId) {
  return {
    title: data.title || 'Untitled',
    authors: data.authors || [],
    source,
    sourceId,
    ...data
  };
}

/**
 * Create default capabilities (all false)
 * @returns {PluginCapabilities}
 */
function createDefaultCapabilities() {
  return {
    search: false,
    lookup: false,
    references: false,
    citations: false,
    pdfDownload: false,
    bibtex: false,
    metadata: false
  };
}

/**
 * Create default search capabilities
 * @returns {SearchCapabilities}
 */
function createDefaultSearchCapabilities() {
  return {
    supportsFullText: false,
    supportsReferences: false,
    supportsCitations: false,
    supportsDateRange: true,
    supportsBooleanOperators: false,
    supportsFieldSearch: false,
    maxResults: 100,
    queryLanguage: 'generic',
    sortOptions: ['date', 'relevance']
  };
}

/**
 * Validate that a plugin implements required methods
 * @param {Object} plugin - Plugin to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
function validatePlugin(plugin) {
  const errors = [];

  // Required properties
  const requiredProps = ['id', 'name', 'capabilities', 'auth'];
  for (const prop of requiredProps) {
    if (!plugin[prop]) {
      errors.push(`Missing required property: ${prop}`);
    }
  }

  // Required methods based on capabilities
  if (plugin.capabilities?.search && typeof plugin.search !== 'function') {
    errors.push('Plugin declares search capability but has no search() method');
  }
  if (plugin.capabilities?.lookup && typeof plugin.getRecord !== 'function') {
    errors.push('Plugin declares lookup capability but has no getRecord() method');
  }
  if (plugin.capabilities?.pdfDownload) {
    if (typeof plugin.getPdfSources !== 'function') {
      errors.push('Plugin declares pdfDownload capability but has no getPdfSources() method');
    }
    if (typeof plugin.downloadPdf !== 'function') {
      errors.push('Plugin declares pdfDownload capability but has no downloadPdf() method');
    }
  }

  // ID format validation
  if (plugin.id && !/^[a-z][a-z0-9_-]*$/.test(plugin.id)) {
    errors.push('Plugin ID must be lowercase alphanumeric with optional - or _');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Factory functions
  createPaper,
  createDefaultCapabilities,
  createDefaultSearchCapabilities,
  validatePlugin,

  // Constants for common values
  SORT_OPTIONS: {
    DATE: 'date',
    CITATIONS: 'citations',
    RELEVANCE: 'relevance'
  },

  PDF_SOURCE_TYPES: {
    ARXIV: 'arxiv',
    PUBLISHER: 'publisher',
    ADS_SCAN: 'ads_scan',
    AUTHOR: 'author',
    OPEN_ACCESS: 'open_access'
  },

  AUTH_TYPES: {
    NONE: 'none',
    API_KEY: 'api_key',
    OAUTH: 'oauth',
    INSTITUTIONAL: 'institutional'
  }
};
