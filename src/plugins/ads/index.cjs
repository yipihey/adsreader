/**
 * ADS Plugin - NASA ADS Source Plugin
 *
 * Implements the SourcePlugin interface for NASA ADS (Astrophysics Data System).
 * Wraps the existing ADS API functionality to provide a unified plugin interface.
 */

'use strict';

const {
  createPaper,
  createDefaultCapabilities,
  createDefaultSearchCapabilities,
  PDF_SOURCE_TYPES,
  AUTH_TYPES
} = require('../../lib/plugins/types.cjs');

const adsApi = require('../../main/ads-api.cjs');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert ADS document to plugin Paper format
 * Uses the existing adsToPaper transform and adds plugin-specific fields
 * @param {Object} adsDoc - ADS API document
 * @returns {Object} Paper object
 */
function adsDocToPaper(adsDoc) {
  if (!adsDoc) return null;

  const paper = adsApi.adsToPaper(adsDoc);

  return createPaper({
    bibcode: paper.bibcode,
    arxivId: paper.arxiv_id,
    doi: paper.doi,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    journal: paper.journal,
    abstract: paper.abstract,
    keywords: paper.keywords,
    citationCount: paper.citation_count
  }, 'ads', paper.bibcode);
}

/**
 * Convert UnifiedQuery to ADS query string
 * @param {Object} query - UnifiedQuery object
 * @returns {string} ADS query string
 */
function translateQueryToADS(query) {
  // If raw query provided, use it directly
  if (query.raw) {
    return query.raw;
  }

  const parts = [];

  // Exact lookups
  if (query.bibcode) {
    return `bibcode:"${query.bibcode}"`;
  }
  if (query.doi) {
    return `doi:"${query.doi}"`;
  }
  if (query.arxivId) {
    const normalizedId = query.arxivId.replace(/^arXiv:/i, '');
    return `arxiv:${normalizedId}`;
  }

  // Field searches
  if (query.title) {
    parts.push(`title:"${query.title}"`);
  }
  if (query.author) {
    // Use ^ for first author if specified
    parts.push(`author:"${query.author}"`);
  }
  if (query.abstract) {
    parts.push(`abs:"${query.abstract}"`);
  }
  if (query.fullText) {
    parts.push(`full:"${query.fullText}"`);
  }

  // Year filter
  if (query.year) {
    if (Array.isArray(query.year)) {
      parts.push(`year:[${query.year[0]} TO ${query.year[1]}]`);
    } else {
      parts.push(`year:${query.year}`);
    }
  }

  // Keywords
  if (query.keywords && query.keywords.length > 0) {
    const kwQuery = query.keywords.map(kw => `keyword:"${kw}"`).join(' OR ');
    parts.push(`(${kwQuery})`);
  }

  return parts.join(' ');
}

/**
 * Convert sort option to ADS format
 * @param {string} sort - Sort option ('date', 'citations', 'relevance')
 * @param {string} direction - Sort direction ('asc', 'desc')
 * @returns {string} ADS sort string
 */
function translateSort(sort, direction = 'desc') {
  const sortMap = {
    date: 'date',
    citations: 'citation_count',
    relevance: 'score'
  };
  const adsSort = sortMap[sort] || 'date';
  return `${adsSort} ${direction}`;
}

/**
 * Convert ADS esources to PdfSource format
 * @param {Array} esources - ADS esource records
 * @param {string} bibcode - Paper bibcode (for fallback arXiv URL)
 * @param {string} arxivId - arXiv ID if available
 * @returns {Array} PdfSource array
 */
function esourcesToPdfSources(esources, bibcode, arxivId) {
  const sources = [];
  let priority = 0;

  for (const source of esources) {
    const linkType = source.link_type || source.type || '';
    const url = source.url;

    if (!url || !url.startsWith('http')) continue;

    if (linkType.includes('EPRINT_PDF')) {
      sources.push({
        type: PDF_SOURCE_TYPES.ARXIV,
        url,
        label: 'arXiv PDF',
        requiresAuth: false,
        priority: priority++
      });
    } else if (linkType.includes('PUB_PDF')) {
      sources.push({
        type: PDF_SOURCE_TYPES.PUBLISHER,
        url,
        label: 'Publisher PDF',
        requiresAuth: true,
        priority: priority++
      });
    } else if (linkType.includes('ADS_PDF')) {
      sources.push({
        type: PDF_SOURCE_TYPES.ADS_SCAN,
        url,
        label: 'ADS Scan',
        requiresAuth: false,
        priority: priority++
      });
    }
  }

  // If no arXiv source found but we have arXiv ID, add constructed URL
  if (!sources.some(s => s.type === PDF_SOURCE_TYPES.ARXIV) && arxivId) {
    const cleanId = arxivId.replace(/^arXiv:/i, '').replace(/v\d+$/, '');
    sources.push({
      type: PDF_SOURCE_TYPES.ARXIV,
      url: `https://arxiv.org/pdf/${cleanId}.pdf`,
      label: 'arXiv PDF',
      requiresAuth: false,
      priority: priority++
    });
  }

  return sources;
}

// ============================================================================
// ADS Plugin Implementation
// ============================================================================

/**
 * NASA ADS Source Plugin
 * @type {SourcePlugin}
 */
const adsPlugin = {
  // Plugin identity
  id: 'ads',
  name: 'NASA ADS',
  icon: '\uD83D\uDD2D', // telescope emoji
  description: 'NASA Astrophysics Data System - comprehensive astronomy and physics database',
  homepage: 'https://ui.adsabs.harvard.edu/',

  // Capabilities
  capabilities: {
    search: true,
    lookup: true,
    references: true,
    citations: true,
    pdfDownload: true,
    bibtex: true,
    metadata: true,
    priority: 10 // Highest priority - primary source for astronomy
  },

  searchCapabilities: {
    supportsFullText: true,
    supportsReferences: true,
    supportsCitations: true,
    supportsDateRange: true,
    supportsBooleanOperators: true,
    supportsFieldSearch: true,
    maxResults: 2000,
    queryLanguage: 'ads',
    sortOptions: ['date', 'citations', 'relevance']
  },

  // Search UI configuration
  searchConfig: {
    title: 'Search NASA ADS',
    placeholder: 'e.g., author:smith year:2020-2024 galaxy',
    nlPlaceholder: 'e.g., papers by Smith about galaxy formation...',
    shortcuts: [
      { label: 'author:', insert: 'author:' },
      { label: 'title:', insert: 'title:' },
      { label: 'year:', insert: 'year:' },
      { label: 'abs:', insert: 'abs:' },
      { label: 'bibcode:', insert: 'bibcode:' },
      { label: 'arXiv:', insert: 'arxiv:' }
    ],
    exampleSearches: [
      { label: 'Recent cosmology', query: 'abs:cosmology year:2023-2024' },
      { label: 'Galaxy formation reviews', query: 'title:"galaxy formation" doctype:review' },
      { label: 'Highly cited 2023', query: 'year:2023 citations:[100 TO *]' },
      { label: 'First author Smith', query: 'author:"^Smith" year:2020-2024' }
    ]
  },

  // Query templates for refs/cites
  queryTemplates: {
    references: 'references(bibcode:"{id}")',
    citations: 'citations(bibcode:"{id}")'
  },

  // Natural language translation prompt
  nlPrompt: `You translate a user's natural-language request about scholarly literature into one NASA ADS search query string.

ADS Query Syntax:
- Author: author:"surname" or author:"^surname" (first author)
- Title words: title:"phrase"
- Abstract: abs:"terms"
- Year: year:YYYY or year:YYYY-YYYY
- arXiv ID: arxiv:XXXX.XXXXX
- DOI: doi:"value"
- Bibcode: bibcode:"value"
- Citations: citations:[N TO *] (at least N citations)
- Combine with: AND, OR, NOT (or space for AND)

Examples:
- "papers by Witten on string theory" → author:witten title:"string theory"
- "galaxy formation papers from 2023 with 50+ citations" → abs:"galaxy formation" year:2023 citations:[50 TO *]
- "reviews about dark matter" → abs:"dark matter" doctype:review

Return ONLY the query string, no explanation.`,

  // Authentication
  auth: {
    type: AUTH_TYPES.API_KEY,
    tokenKey: 'ads_api_token',
    description: 'NASA ADS API token',
    helpUrl: 'https://ui.adsabs.harvard.edu/user/settings/token'
  },

  // Internal state
  _token: null,
  _rateLimitStatus: {
    remaining: 5000,
    limit: 5000,
    resetAt: Date.now() + 86400000 // 24 hours
  },

  /**
   * Initialize the plugin with API token
   * @param {Object} options
   * @param {string} options.token - ADS API token
   */
  async initialize(options = {}) {
    if (options.token) {
      this._token = options.token;
    }
  },

  /**
   * Shutdown the plugin
   */
  async shutdown() {
    this._token = null;
  },

  /**
   * Set or update the API token
   * @param {string} token
   */
  setToken(token) {
    this._token = token;
  },

  /**
   * Get the current token
   * @returns {string|null}
   */
  getToken() {
    return this._token;
  },

  /**
   * Validate that authentication is configured and working
   * @returns {Promise<boolean>}
   */
  async validateAuth() {
    if (!this._token) {
      return false;
    }
    try {
      const result = await adsApi.validateToken(this._token);
      return result.valid;
    } catch (error) {
      return false;
    }
  },

  /**
   * Get current rate limit status
   * @returns {RateLimitStatus}
   */
  getRateLimitStatus() {
    return { ...this._rateLimitStatus };
  },

  /**
   * Translate a UnifiedQuery to ADS native query format
   * @param {UnifiedQuery} query
   * @returns {string}
   */
  translateQuery(query) {
    return translateQueryToADS(query);
  },

  /**
   * Search for papers
   * @param {UnifiedQuery} query
   * @returns {Promise<SearchResult>}
   */
  async search(query) {
    if (!this._token) {
      throw new Error('ADS plugin not authenticated. Set token before searching.');
    }

    const adsQuery = translateQueryToADS(query);
    const sort = translateSort(query.sort || 'date', query.sortDirection || 'desc');

    const options = {
      rows: query.limit || 25,
      start: query.offset || 0,
      sort
    };

    const result = await adsApi.search(this._token, adsQuery, options);

    const papers = (result.docs || []).map(doc => adsDocToPaper(doc));

    return {
      papers,
      totalResults: result.numFound || papers.length,
      metadata: {
        query: adsQuery,
        sort,
        source: 'ads'
      }
    };
  },

  /**
   * Get a paper by its bibcode (source ID)
   * @param {string} bibcode
   * @returns {Promise<Paper|null>}
   */
  async getRecord(bibcode) {
    if (!this._token) {
      throw new Error('ADS plugin not authenticated');
    }

    const doc = await adsApi.getByBibcode(this._token, bibcode);
    return adsDocToPaper(doc);
  },

  /**
   * Get a paper by DOI
   * @param {string} doi
   * @returns {Promise<Paper|null>}
   */
  async getByDOI(doi) {
    if (!this._token) {
      throw new Error('ADS plugin not authenticated');
    }

    const doc = await adsApi.getByDOI(this._token, doi);
    return adsDocToPaper(doc);
  },

  /**
   * Get a paper by arXiv ID
   * @param {string} arxivId
   * @returns {Promise<Paper|null>}
   */
  async getByArxiv(arxivId) {
    if (!this._token) {
      throw new Error('ADS plugin not authenticated');
    }

    const doc = await adsApi.getByArxiv(this._token, arxivId);
    return adsDocToPaper(doc);
  },

  /**
   * Batch lookup multiple papers by bibcode
   * @param {string[]} bibcodes
   * @returns {Promise<Paper[]>}
   */
  async getBatch(bibcodes) {
    if (!this._token) {
      throw new Error('ADS plugin not authenticated');
    }

    const docs = await adsApi.getByBibcodes(this._token, bibcodes);
    return docs.map(doc => adsDocToPaper(doc)).filter(Boolean);
  },

  /**
   * Get references (papers this paper cites)
   * @param {string} bibcode
   * @param {Object} options
   * @param {number} [options.limit=200]
   * @returns {Promise<Paper[]>}
   */
  async getReferences(bibcode, options = {}) {
    if (!this._token) {
      throw new Error('ADS plugin not authenticated');
    }

    const docs = await adsApi.getReferences(this._token, bibcode, {
      rows: options.limit || 200
    });
    return docs.map(doc => adsDocToPaper(doc)).filter(Boolean);
  },

  /**
   * Get citations (papers that cite this paper)
   * @param {string} bibcode
   * @param {Object} options
   * @param {number} [options.limit=200]
   * @returns {Promise<Paper[]>}
   */
  async getCitations(bibcode, options = {}) {
    if (!this._token) {
      throw new Error('ADS plugin not authenticated');
    }

    const docs = await adsApi.getCitations(this._token, bibcode, {
      rows: options.limit || 200
    });
    return docs.map(doc => adsDocToPaper(doc)).filter(Boolean);
  },

  /**
   * Get available PDF sources for a paper
   * @param {string} bibcode
   * @returns {Promise<PdfSource[]>}
   */
  async getPdfSources(bibcode) {
    if (!this._token) {
      throw new Error('ADS plugin not authenticated');
    }

    // First get the paper to check for arXiv ID
    const doc = await adsApi.getByBibcode(this._token, bibcode);
    const arxivId = doc ? adsApi.extractArxivId(doc.identifier) : null;

    // Get esources from ADS
    const esources = await adsApi.getEsources(this._token, bibcode);

    return esourcesToPdfSources(esources, bibcode, arxivId);
  },

  /**
   * Download a PDF from a source
   * Note: This is a placeholder - actual download logic is handled by the app
   * @param {PdfSource} source
   * @param {Object} options
   * @returns {Promise<Buffer>}
   */
  async downloadPdf(source, options = {}) {
    // PDF download is handled by the main app's pdf-download module
    // This method is here to satisfy the interface
    throw new Error('PDF download should be handled by the application pdf-download module');
  },

  /**
   * Get BibTeX for a single paper
   * @param {string} bibcode
   * @returns {Promise<string>}
   */
  async getBibtex(bibcode) {
    if (!this._token) {
      throw new Error('ADS plugin not authenticated');
    }

    return await adsApi.exportBibtex(this._token, bibcode);
  },

  /**
   * Get BibTeX for multiple papers
   * @param {string[]} bibcodes
   * @returns {Promise<Map<string,string>>}
   */
  async getBibtexBatch(bibcodes) {
    if (!this._token) {
      throw new Error('ADS plugin not authenticated');
    }

    const bibtex = await adsApi.exportBibtex(this._token, bibcodes);

    // Parse the combined BibTeX and split by entry
    // BibTeX entries start with @type{key,
    const entries = new Map();
    const entryRegex = /@\w+\{([^,]+),[\s\S]*?(?=\n@|\n*$)/g;
    let match;

    while ((match = entryRegex.exec(bibtex)) !== null) {
      const key = match[1].trim();
      entries.set(key, match[0]);
    }

    return entries;
  },

  /**
   * Smart search using multiple strategies (title, author, year matching)
   * @param {Object} metadata
   * @param {string} [metadata.title]
   * @param {string} [metadata.firstAuthor]
   * @param {number|string} [metadata.year]
   * @param {string} [metadata.journal]
   * @returns {Promise<Paper|null>}
   */
  async smartSearch(metadata) {
    if (!this._token) {
      throw new Error('ADS plugin not authenticated');
    }

    const doc = await adsApi.smartSearch(this._token, metadata);
    return adsDocToPaper(doc);
  },

  /**
   * Reset sync statistics
   */
  resetStats() {
    adsApi.resetSyncStats();
  },

  /**
   * Get sync statistics
   * @returns {{bytesReceived: number, requestCount: number}}
   */
  getStats() {
    return adsApi.getSyncStats();
  },

  /**
   * Get URL to view paper on ADS website
   * @param {Object} paper - Paper object with bibcode
   * @returns {string} URL to ADS abstract page
   */
  getRecordUrl(paper) {
    const bibcode = paper.bibcode || paper.sourceId;
    if (!bibcode) return null;
    return `https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(bibcode)}/abstract`;
  }
};

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  adsPlugin,
  // Also export helper functions for testing
  translateQueryToADS,
  adsDocToPaper,
  esourcesToPdfSources
};
