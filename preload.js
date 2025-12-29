/**
 * SciX Reader - Preload Script
 * Exposes IPC methods to the renderer process via window.electronAPI
 *
 * Methods are organized by category:
 * - Library Management: Library path, folder selection, cloud status
 * - PDF Settings: Zoom, page positions
 * - Paper Management: CRUD operations, import, search
 * - ADS Integration: Search, sync, references, citations, esources
 * - SciX Search: Alternative search and import
 * - BibTeX: Citation copying, export, import
 * - Collections: Folder organization
 * - References/Citations: Paper relationships
 * - LLM/AI: Summarization, Q&A, embeddings, semantic search
 * - Annotations: PDF highlights and notes
 * - Utilities: External links, file operations, console logging
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ═══════════════════════════════════════════════════════════════════════════
  // LIBRARY MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  getLibraryPath: () => ipcRenderer.invoke('get-library-path'),
  selectLibraryFolder: () => ipcRenderer.invoke('select-library-folder'),
  checkCloudStatus: (path) => ipcRenderer.invoke('check-cloud-status', path),
  getLibraryInfo: (path) => ipcRenderer.invoke('get-library-info', path),

  // ═══════════════════════════════════════════════════════════════════════════
  // PDF SETTINGS
  // ═══════════════════════════════════════════════════════════════════════════
  getPdfZoom: () => ipcRenderer.invoke('get-pdf-zoom'),
  setPdfZoom: (zoom) => ipcRenderer.invoke('set-pdf-zoom', zoom),

  // Last selected paper persistence
  getLastSelectedPaper: () => ipcRenderer.invoke('get-last-selected-paper'),
  setLastSelectedPaper: (paperId) => ipcRenderer.invoke('set-last-selected-paper', paperId),

  // PDF page positions persistence
  getPdfPositions: () => ipcRenderer.invoke('get-pdf-positions'),
  setPdfPosition: (paperId, position) => ipcRenderer.invoke('set-pdf-position', paperId, position),

  // ═══════════════════════════════════════════════════════════════════════════
  // PAPER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  importPDFs: () => ipcRenderer.invoke('import-pdfs'),
  getAllPapers: (options) => ipcRenderer.invoke('get-all-papers', options),
  getPaper: (id) => ipcRenderer.invoke('get-paper', id),
  updatePaper: (id, updates) => ipcRenderer.invoke('update-paper', id, updates),
  deletePaper: (id) => ipcRenderer.invoke('delete-paper', id),
  deletePapersBulk: (ids) => ipcRenderer.invoke('delete-papers-bulk', ids),
  getPdfPath: (relativePath) => ipcRenderer.invoke('get-pdf-path', relativePath),
  searchPapers: (query) => ipcRenderer.invoke('search-papers', query),

  // ═══════════════════════════════════════════════════════════════════════════
  // ADS INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════
  getAdsToken: () => ipcRenderer.invoke('get-ads-token'),
  setAdsToken: (token) => ipcRenderer.invoke('set-ads-token', token),
  getLibraryProxy: () => ipcRenderer.invoke('get-library-proxy'),
  setLibraryProxy: (proxyUrl) => ipcRenderer.invoke('set-library-proxy', proxyUrl),
  getPdfPriority: () => ipcRenderer.invoke('get-pdf-priority'),
  setPdfPriority: (priority) => ipcRenderer.invoke('set-pdf-priority', priority),
  adsSearch: (query, options) => ipcRenderer.invoke('ads-search', query, options),
  adsLookup: (identifier, type) => ipcRenderer.invoke('ads-lookup', identifier, type),
  adsGetReferences: (bibcode) => ipcRenderer.invoke('ads-get-references', bibcode),
  adsGetCitations: (bibcode) => ipcRenderer.invoke('ads-get-citations', bibcode),
  adsGetEsources: (bibcode) => ipcRenderer.invoke('ads-get-esources', bibcode),
  downloadPdfFromSource: (paperId, sourceType) => ipcRenderer.invoke('download-pdf-from-source', paperId, sourceType),
  checkPdfExists: (paperId, sourceType) => ipcRenderer.invoke('check-pdf-exists', paperId, sourceType),
  adsFetchMetadata: (paperId) => ipcRenderer.invoke('ads-fetch-metadata', paperId),
  adsSyncPapers: (paperIds) => ipcRenderer.invoke('ads-sync-papers', paperIds),
  onAdsSyncProgress: (callback) => ipcRenderer.on('ads-sync-progress', (event, data) => callback(data)),
  removeAdsSyncListeners: () => ipcRenderer.removeAllListeners('ads-sync-progress'),

  // ═══════════════════════════════════════════════════════════════════════════
  // SCIX SEARCH & IMPORT
  // ═══════════════════════════════════════════════════════════════════════════
  scixSearch: (query, options) => ipcRenderer.invoke('scix-search', query, options),
  importFromScix: (papers) => ipcRenderer.invoke('import-from-scix', papers),
  onImportProgress: (callback) => ipcRenderer.on('import-progress', (event, data) => callback(data)),
  onImportComplete: (callback) => ipcRenderer.on('import-complete', (event, data) => callback(data)),
  removeImportListeners: () => {
    ipcRenderer.removeAllListeners('import-progress');
    ipcRenderer.removeAllListeners('import-complete');
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BIBTEX
  // ═══════════════════════════════════════════════════════════════════════════
  copyCite: (paperId, style) => ipcRenderer.invoke('copy-cite', paperId, style),
  exportBibtex: (paperIds) => ipcRenderer.invoke('export-bibtex', paperIds),
  saveBibtexFile: (content) => ipcRenderer.invoke('save-bibtex-file', content),
  importBibtex: () => ipcRenderer.invoke('import-bibtex'),

  // ═══════════════════════════════════════════════════════════════════════════
  // COLLECTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  getCollections: () => ipcRenderer.invoke('get-collections'),
  createCollection: (name, parentId, isSmart, query) => ipcRenderer.invoke('create-collection', name, parentId, isSmart, query),
  deleteCollection: (collectionId) => ipcRenderer.invoke('delete-collection', collectionId),
  addPaperToCollection: (paperId, collectionId) => ipcRenderer.invoke('add-paper-to-collection', paperId, collectionId),
  removePaperFromCollection: (paperId, collectionId) => ipcRenderer.invoke('remove-paper-from-collection', paperId, collectionId),
  getPapersInCollection: (collectionId) => ipcRenderer.invoke('get-papers-in-collection', collectionId),

  // ═══════════════════════════════════════════════════════════════════════════
  // REFERENCES & CITATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  getReferences: (paperId) => ipcRenderer.invoke('get-references', paperId),
  getCitations: (paperId) => ipcRenderer.invoke('get-citations', paperId),

  // ═══════════════════════════════════════════════════════════════════════════
  // LLM / AI
  // ═══════════════════════════════════════════════════════════════════════════
  getLlmConfig: () => ipcRenderer.invoke('get-llm-config'),
  setLlmConfig: (config) => ipcRenderer.invoke('set-llm-config', config),
  checkLlmConnection: () => ipcRenderer.invoke('check-llm-connection'),
  listLlmModels: () => ipcRenderer.invoke('list-llm-models'),
  llmSummarize: (paperId, options) => ipcRenderer.invoke('llm-summarize', paperId, options),
  llmAsk: (paperId, question) => ipcRenderer.invoke('llm-ask', paperId, question),
  llmExplain: (text, paperId) => ipcRenderer.invoke('llm-explain', text, paperId),
  llmGenerateEmbeddings: (paperId) => ipcRenderer.invoke('llm-generate-embeddings', paperId),
  llmGetUnindexedPapers: () => ipcRenderer.invoke('llm-get-unindexed-papers'),
  llmExtractMetadata: (paperId) => ipcRenderer.invoke('llm-extract-metadata', paperId),
  applyAdsMetadata: (paperId, adsDoc) => ipcRenderer.invoke('apply-ads-metadata', paperId, adsDoc),
  importSingleFromAds: (adsDoc) => ipcRenderer.invoke('import-single-from-ads', adsDoc),
  llmSemanticSearch: (query, limit) => ipcRenderer.invoke('llm-semantic-search', query, limit),
  llmGetQAHistory: (paperId) => ipcRenderer.invoke('llm-get-qa-history', paperId),
  llmClearQAHistory: (paperId) => ipcRenderer.invoke('llm-clear-qa-history', paperId),
  llmDeleteSummary: (paperId) => ipcRenderer.invoke('llm-delete-summary', paperId),
  onLlmStream: (callback) => ipcRenderer.on('llm-stream', (event, data) => callback(data)),
  removeLlmListeners: () => ipcRenderer.removeAllListeners('llm-stream'),

  // ═══════════════════════════════════════════════════════════════════════════
  // ANNOTATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  getAnnotations: (paperId) => ipcRenderer.invoke('get-annotations', paperId),
  getAnnotationCountsBySource: (paperId) => ipcRenderer.invoke('get-annotation-counts-by-source', paperId),
  getDownloadedPdfSources: (paperId) => ipcRenderer.invoke('get-downloaded-pdf-sources', paperId),
  deletePdf: (paperId, sourceType) => ipcRenderer.invoke('delete-pdf', paperId, sourceType),
  createAnnotation: (paperId, data) => ipcRenderer.invoke('create-annotation', paperId, data),
  updateAnnotation: (id, data) => ipcRenderer.invoke('update-annotation', id, data),
  deleteAnnotation: (id) => ipcRenderer.invoke('delete-annotation', id),

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  downloadPublisherPdf: (paperId, publisherUrl, proxyUrl) => ipcRenderer.invoke('download-publisher-pdf', paperId, publisherUrl, proxyUrl),
  showInFinder: (filePath) => ipcRenderer.invoke('show-in-finder', filePath),

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENTS (from main process)
  // ═══════════════════════════════════════════════════════════════════════════
  onConsoleLog: (callback) => ipcRenderer.on('console-log', (event, data) => callback(data)),
  removeConsoleLogListeners: () => ipcRenderer.removeAllListeners('console-log'),

  // Platform info
  platform: process.platform
});
