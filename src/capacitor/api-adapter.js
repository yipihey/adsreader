/**
 * ADS Reader - Capacitor API Adapter
 * Provides the same interface as window.electronAPI but for iOS/Capacitor
 *
 * This module is dynamically imported by src/renderer/api.js when running on iOS.
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { CapacitorHttp } from '@capacitor/core';

// Import SQLite database module
import * as MobileDB from './mobile-database.js';

// Import shared utilities
import {
  adsToPaper,
  extractArxivId,
  safeJsonParse,
  generatePdfFilename,
  sanitizeBibcodeForFilename
} from '../shared/paper-utils.js';
import {
  ADS_API_BASE,
  ADS_SEARCH_FIELDS,
  LIBRARY_FOLDER_NAME,
  DEFAULT_PDF_PRIORITY
} from '../shared/constants.js';

// Cloud LLM service instance
let cloudLlmService = null;

// Database initialized flag
let dbInitialized = false;

// Library folder name in Documents (use constant or fallback)
const LIBRARY_FOLDER = LIBRARY_FOLDER_NAME || 'ADSReader';

// Legacy JSON file for migration
const LEGACY_PAPERS_FILE = 'papers.json';

// Database initialization and migration helpers
async function ensureLibraryExists() {
  try {
    await Filesystem.mkdir({
      path: LIBRARY_FOLDER,
      directory: Directory.Documents,
      recursive: true
    });
    await Filesystem.mkdir({
      path: `${LIBRARY_FOLDER}/papers`,
      directory: Directory.Documents,
      recursive: true
    });
    await Filesystem.mkdir({
      path: `${LIBRARY_FOLDER}/text`,
      directory: Directory.Documents,
      recursive: true
    });
  } catch (e) {
    // Directory may already exist
  }
}

// Initialize SQLite database
async function initializeDatabase() {
  if (dbInitialized) return true;

  try {
    await ensureLibraryExists();
    await MobileDB.initDatabase(LIBRARY_FOLDER);
    dbInitialized = true;

    // Check for legacy JSON data and migrate if needed
    await migrateLegacyData();

    console.log('[API] SQLite database initialized');
    return true;
  } catch (error) {
    console.error('[API] Failed to initialize database:', error);
    return false;
  }
}

// Migrate legacy papers.json to SQLite
async function migrateLegacyData() {
  try {
    const result = await Filesystem.readFile({
      path: `${LIBRARY_FOLDER}/${LEGACY_PAPERS_FILE}`,
      directory: Directory.Documents,
      encoding: Encoding.UTF8
    });

    const legacyPapers = JSON.parse(result.data) || [];
    if (legacyPapers.length === 0) return;

    console.log(`[API] Migrating ${legacyPapers.length} papers from JSON to SQLite...`);

    for (const paper of legacyPapers) {
      // Check if paper already exists in SQLite
      const existing = MobileDB.getPaperByBibcode(paper.bibcode);
      if (!existing) {
        MobileDB.addPaper({
          ...paper,
          added_date: paper.date_added || paper.added_date || new Date().toISOString()
        });
      }
    }

    await MobileDB.saveDatabase();

    // Rename legacy file to prevent re-migration
    await Filesystem.rename({
      from: `${LIBRARY_FOLDER}/${LEGACY_PAPERS_FILE}`,
      to: `${LIBRARY_FOLDER}/${LEGACY_PAPERS_FILE}.migrated`,
      directory: Directory.Documents
    });

    console.log('[API] Migration complete');
  } catch (e) {
    // No legacy file or already migrated
    if (!e.message?.includes('File does not exist')) {
      console.log('[API] No legacy data to migrate or already migrated');
    }
  }
}

// extractArxivId imported from shared/paper-utils.js

// Helper to download PDF for a paper (standalone function)
async function downloadPaperPdf(paper, token, pdfPriority) {
  try {
    console.log('[downloadPaperPdf] Starting for', paper.bibcode);

    // Ensure library folders exist
    await ensureLibraryExists();

    // Get e-sources from ADS
    const esourcesUrl = `${ADS_API_BASE}/resolver/${paper.bibcode}/esources`;
    console.log('[downloadPaperPdf] Fetching e-sources from', esourcesUrl);

    const response = await CapacitorHttp.get({
      url: esourcesUrl,
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('[downloadPaperPdf] E-sources response status:', response.status);

    if (response.status !== 200) {
      return { success: false, error: 'Failed to get e-sources' };
    }

    const links = response.data?.links || [];
    console.log('[downloadPaperPdf] Available links:', links.map(l => l.type));

    // Try sources in priority order
    for (const sourceType of pdfPriority) {
      const source = links.find(l => l.type === sourceType);
      if (!source || !source.url) continue;

      try {
        // For arXiv, construct direct PDF URL
        let pdfUrl = source.url;
        if (sourceType === 'EPRINT_PDF' && paper.arxiv_id) {
          pdfUrl = `https://arxiv.org/pdf/${paper.arxiv_id}.pdf`;
        }

        console.log('[downloadPaperPdf] Trying', sourceType, 'from', pdfUrl);
        emit('consoleLog', { message: `[${paper.bibcode}] Trying ${sourceType}...`, level: 'info' });

        // Download the PDF
        const filename = `${paper.bibcode.replace(/\//g, '_')}_${sourceType}.pdf`;
        const filePath = `${LIBRARY_FOLDER}/papers/${filename}`;

        console.log('[downloadPaperPdf] Downloading to', filePath);

        const downloadResult = await Filesystem.downloadFile({
          url: pdfUrl,
          path: filePath,
          directory: Directory.Documents,
          progress: true
        });

        console.log('[downloadPaperPdf] Download result:', downloadResult);

        if (downloadResult.path) {
          return {
            success: true,
            path: `papers/${filename}`,
            source: sourceType
          };
        }
      } catch (e) {
        console.error('[downloadPaperPdf] Download failed:', e);
        emit('consoleLog', { message: `[${paper.bibcode}] ${sourceType} download failed: ${e.message}`, level: 'warn' });
      }
    }

    return { success: false, error: 'No PDF sources available' };
  } catch (error) {
    console.error('[downloadPaperPdf] Error:', error);
    return { success: false, error: error.message };
  }
}

// adsToPaper imported from shared/paper-utils.js

// Event emitter for iOS (simple implementation)
const eventListeners = {
  consoleLog: [],
  adsSyncProgress: [],
  importProgress: [],
  importComplete: [],
  llmStream: [],
};

function emit(event, data) {
  const listeners = eventListeners[event] || [];
  listeners.forEach(cb => {
    try {
      cb(data);
    } catch (e) {
      console.error(`Error in ${event} listener:`, e);
    }
  });
}

// Helper to safely parse JSON
function safeJsonParse(str) {
  try {
    return str ? JSON.parse(str) : null;
  } catch {
    return str;
  }
}

// Storage helpers
const Storage = {
  async get(key) {
    const result = await Preferences.get({ key });
    return safeJsonParse(result.value);
  },
  async set(key, value) {
    await Preferences.set({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value)
    });
  }
};

// Keychain helpers
const Keychain = {
  async getItem(key) {
    try {
      const value = await SecureStorage.get(key);
      console.log(`[Keychain] getItem(${key}):`, value ? '(value exists)' : 'null');
      return value;
    } catch (e) {
      console.log(`[Keychain] getItem(${key}) error:`, e.message);
      return null;
    }
  },
  async setItem(key, value) {
    console.log(`[Keychain] setItem(${key}):`, value ? '(setting value)' : 'null');
    await SecureStorage.set(key, value);
  }
};

/**
 * Create and initialize the Capacitor API
 * @returns {Promise<object>} The initialized API object
 */
export async function createCapacitorAPI() {
  try {
    console.log('[createCapacitorAPI] Starting initialization...');

    // Add iOS class to body for platform-specific CSS
    try {
      document.body.classList.add('ios');
      console.log('[createCapacitorAPI] Added iOS class to body');
    } catch (e) {
      console.warn('[createCapacitorAPI] Failed to add iOS class:', e);
    }

    // Set up haptic feedback on button taps (non-blocking)
    try {
      document.addEventListener('click', (e) => {
        if (e.target.matches('button, .btn, .primary-button, .tab-btn, .nav-item')) {
          Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
        }
      });
      console.log('[createCapacitorAPI] Set up haptic feedback');
    } catch (e) {
      console.warn('[createCapacitorAPI] Haptics setup failed:', e);
    }

    // Initialize SQLite database
    try {
      await initializeDatabase();
      console.log('[createCapacitorAPI] SQLite database initialized');
    } catch (e) {
      console.error('[createCapacitorAPI] Failed to initialize database:', e);
    }

    // Initialize cloud LLM service if configured (but don't fail if it errors)
    try {
      const cloudConfig = await Storage.get('cloudLlmConfig');
      if (cloudConfig) {
        const { CloudLLMService } = await import('../main/cloud-llm-service.js');
        const apiKey = await Keychain.getItem('cloudLlmApiKey');
        cloudLlmService = new CloudLLMService({ ...cloudConfig, apiKey });
        console.log('[createCapacitorAPI] Cloud LLM initialized');
      }
    } catch (e) {
      console.warn('[createCapacitorAPI] Failed to initialize cloud LLM:', e);
    }

    console.log('[createCapacitorAPI] Returning API object');
    // Return the API object
    return capacitorAPI;
  } catch (error) {
    console.error('[createCapacitorAPI] Critical error during initialization:', error);
    // Still return the API object even if initialization had issues
    return capacitorAPI;
  }
}

/**
 * Capacitor API implementation
 * Matches the interface of window.electronAPI from preload.js
 */
const capacitorAPI = {
  // ═══════════════════════════════════════════════════════════════════════════
  // LIBRARY MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async getLibraryPath() {
    const result = await Preferences.get({ key: 'libraryPath' });
    return result.value || null;
  },

  async selectLibraryFolder() {
    // On iOS, we automatically use a fixed folder in Documents
    try {
      await Filesystem.mkdir({
        path: LIBRARY_FOLDER,
        directory: Directory.Documents,
        recursive: true
      });
      await Filesystem.mkdir({
        path: `${LIBRARY_FOLDER}/papers`,
        directory: Directory.Documents,
        recursive: true
      });

      await Preferences.set({ key: 'libraryPath', value: LIBRARY_FOLDER });
      console.log('[API] Library folder created:', LIBRARY_FOLDER);
      return LIBRARY_FOLDER;
    } catch (error) {
      console.error('[API] Failed to create library folder:', error);
      return null;
    }
  },

  async getLibraryInfo(path) {
    if (!path) return null;
    try {
      const dbPath = `${path}/library.db`;
      try {
        await Filesystem.stat({ path: dbPath, directory: Directory.Documents });
        return { exists: true, hasDatabase: true };
      } catch {
        try {
          await Filesystem.stat({ path: path, directory: Directory.Documents });
          return { exists: true, hasDatabase: false };
        } catch {
          return null;
        }
      }
    } catch {
      return null;
    }
  },

  async checkCloudStatus(path) {
    return { isCloud: true, service: 'iCloud' };
  },

  // iCloud library management - iOS uses iCloud container by default
  async getICloudContainerPath() {
    // On iOS, we use the iCloud Documents directory directly
    return 'iCloud';
  },

  async isICloudAvailable() {
    // On iOS, iCloud is available if the container exists
    try {
      await Filesystem.readdir({
        path: '',
        directory: Directory.ICloud
      });
      return true;
    } catch (e) {
      console.log('[API] iCloud not available:', e.message);
      return false;
    }
  },

  async getAllLibraries() {
    const libraries = [];

    // On iOS, all libraries are in iCloud
    try {
      const isAvailable = await this.isICloudAvailable();
      if (!isAvailable) {
        console.log('[API] iCloud not available, returning empty libraries');
        return libraries;
      }

      // Read libraries.json from iCloud
      try {
        const result = await Filesystem.readFile({
          path: 'libraries.json',
          directory: Directory.ICloud,
          encoding: Encoding.UTF8
        });

        const data = JSON.parse(result.data);
        for (const lib of data.libraries || []) {
          libraries.push({
            ...lib,
            fullPath: lib.path,
            location: 'icloud',
            exists: true // Assume exists, we'll verify on switch
          });
        }
      } catch (e) {
        // No libraries.json yet, that's ok
        console.log('[API] No libraries.json found, will create on first library creation');
      }
    } catch (error) {
      console.error('[API] Error reading iCloud libraries:', error);
    }

    return libraries;
  },

  async createLibrary(options) {
    const { name } = options;
    // On iOS, all libraries go to iCloud (no local option)
    const location = 'icloud';

    try {
      const id = crypto.randomUUID();
      const safeName = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Library';

      // Check if iCloud is available
      const isAvailable = await this.isICloudAvailable();
      if (!isAvailable) {
        return { success: false, error: 'iCloud is not available. Please sign in to iCloud.' };
      }

      // Create library folder in iCloud
      await Filesystem.mkdir({
        path: safeName,
        directory: Directory.ICloud,
        recursive: true
      });

      await Filesystem.mkdir({
        path: `${safeName}/papers`,
        directory: Directory.ICloud,
        recursive: true
      });

      await Filesystem.mkdir({
        path: `${safeName}/text`,
        directory: Directory.ICloud,
        recursive: true
      });

      // Update libraries.json
      let data = { version: 1, libraries: [] };
      try {
        const result = await Filesystem.readFile({
          path: 'libraries.json',
          directory: Directory.ICloud,
          encoding: Encoding.UTF8
        });
        data = JSON.parse(result.data);
      } catch (e) {
        // No existing file, use default
      }

      data.libraries.push({
        id,
        name: safeName,
        path: safeName,
        createdAt: new Date().toISOString(),
        createdOn: 'iOS'
      });

      await Filesystem.writeFile({
        path: 'libraries.json',
        directory: Directory.ICloud,
        data: JSON.stringify(data, null, 2),
        encoding: Encoding.UTF8
      });

      return { success: true, id, path: safeName };
    } catch (error) {
      console.error('[API] Failed to create library:', error);
      return { success: false, error: error.message };
    }
  },

  async switchLibrary(libraryId) {
    try {
      // Find library by ID
      const allLibraries = await this.getAllLibraries();
      const library = allLibraries.find(l => l.id === libraryId);

      if (!library) {
        return { success: false, error: 'Library not found' };
      }

      // Close current database
      if (MobileDB.isInitialized()) {
        await MobileDB.saveDatabase();
        MobileDB.closeDatabase();
      }
      dbInitialized = false;

      // Initialize database from iCloud library
      // For iCloud, we need to use a different path approach
      await MobileDB.initDatabase(library.fullPath);
      dbInitialized = true;

      // Save current library info
      await Preferences.set({ key: 'currentLibraryId', value: libraryId });
      await Preferences.set({ key: 'libraryPath', value: library.fullPath });

      return { success: true, path: library.fullPath };
    } catch (error) {
      console.error('[API] Failed to switch library:', error);
      return { success: false, error: error.message };
    }
  },

  async getCurrentLibraryId() {
    const result = await Preferences.get({ key: 'currentLibraryId' });
    return result.value || null;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LIBRARY MIGRATION
  // ═══════════════════════════════════════════════════════════════════════════

  async checkMigrationNeeded() {
    try {
      // Check if migration already completed
      const migrationDone = await Preferences.get({ key: 'migrationCompleted' });
      if (migrationDone.value === 'true') {
        return { needed: false };
      }

      // Check if we have a current library ID (already registered)
      const currentId = await Preferences.get({ key: 'currentLibraryId' });
      if (currentId.value) {
        return { needed: false };
      }

      // Check for existing local library in Documents
      try {
        const localFiles = await Filesystem.readdir({
          path: LIBRARY_FOLDER,
          directory: Directory.Documents
        });

        // Check if there's data (SQLite or papers.json)
        const hasDatabase = localFiles.files.some(f => f.name === 'library.sqlite');
        const hasLegacyData = localFiles.files.some(f => f.name === 'papers.json');

        if (!hasDatabase && !hasLegacyData) {
          return { needed: false };
        }

        // Count papers
        let paperCount = 0;
        if (hasDatabase && dbInitialized) {
          const stats = MobileDB.getStats();
          paperCount = stats?.total || 0;
        }

        // iCloud is always available on iOS (if app is properly signed)
        const iCloudAvailable = await this.isICloudAvailable();

        return {
          needed: true,
          existingPath: LIBRARY_FOLDER,
          libraryName: 'ADS Library',
          paperCount,
          isInICloud: false,
          iCloudAvailable
        };
      } catch (e) {
        // No local library folder
        return { needed: false };
      }
    } catch (error) {
      console.error('[API] Migration check failed:', error);
      return { needed: false };
    }
  },

  async migrateLibraryToICloud(options) {
    const { libraryPath } = options;

    try {
      const isAvailable = await this.isICloudAvailable();
      if (!isAvailable) {
        return { success: false, error: 'iCloud is not available' };
      }

      const libraryName = 'ADS Library';
      const id = crypto.randomUUID();

      // Create target directory in iCloud
      await Filesystem.mkdir({
        path: libraryName,
        directory: Directory.ICloud,
        recursive: true
      });

      await Filesystem.mkdir({
        path: `${libraryName}/papers`,
        directory: Directory.ICloud,
        recursive: true
      });

      await Filesystem.mkdir({
        path: `${libraryName}/text`,
        directory: Directory.ICloud,
        recursive: true
      });

      // Close database before migration
      if (MobileDB.isInitialized()) {
        await MobileDB.saveDatabase();
        MobileDB.closeDatabase();
      }
      dbInitialized = false;

      // Copy files from Documents to iCloud
      const localFiles = await Filesystem.readdir({
        path: LIBRARY_FOLDER,
        directory: Directory.Documents
      });

      for (const file of localFiles.files) {
        if (file.type === 'file') {
          try {
            const content = await Filesystem.readFile({
              path: `${LIBRARY_FOLDER}/${file.name}`,
              directory: Directory.Documents
            });

            await Filesystem.writeFile({
              path: `${libraryName}/${file.name}`,
              directory: Directory.ICloud,
              data: content.data,
              encoding: file.name.endsWith('.sqlite') ? undefined : Encoding.UTF8
            });
          } catch (e) {
            console.log('[API] Could not copy file:', file.name, e.message);
          }
        }
      }

      // Copy PDFs
      try {
        const pdfFiles = await Filesystem.readdir({
          path: `${LIBRARY_FOLDER}/papers`,
          directory: Directory.Documents
        });

        for (const file of pdfFiles.files) {
          if (file.type === 'file') {
            const content = await Filesystem.readFile({
              path: `${LIBRARY_FOLDER}/papers/${file.name}`,
              directory: Directory.Documents
            });

            await Filesystem.writeFile({
              path: `${libraryName}/papers/${file.name}`,
              directory: Directory.ICloud,
              data: content.data
            });
          }
        }
      } catch (e) {
        console.log('[API] No PDFs to migrate or error:', e.message);
      }

      // Update libraries.json
      let data = { version: 1, libraries: [] };
      try {
        const result = await Filesystem.readFile({
          path: 'libraries.json',
          directory: Directory.ICloud,
          encoding: Encoding.UTF8
        });
        data = JSON.parse(result.data);
      } catch (e) {
        // No existing file
      }

      data.libraries.push({
        id,
        name: libraryName,
        path: libraryName,
        createdAt: new Date().toISOString(),
        createdOn: 'iOS',
        migratedFrom: 'local'
      });

      await Filesystem.writeFile({
        path: 'libraries.json',
        directory: Directory.ICloud,
        data: JSON.stringify(data, null, 2),
        encoding: Encoding.UTF8
      });

      // Save preferences
      await Preferences.set({ key: 'currentLibraryId', value: id });
      await Preferences.set({ key: 'libraryPath', value: libraryName });
      await Preferences.set({ key: 'migrationCompleted', value: 'true' });

      // Delete old local folder
      try {
        await Filesystem.rmdir({
          path: LIBRARY_FOLDER,
          directory: Directory.Documents,
          recursive: true
        });
      } catch (e) {
        console.log('[API] Could not delete old local folder:', e.message);
      }

      // Reinitialize database from iCloud
      await MobileDB.initDatabaseFromICloud(libraryName);
      dbInitialized = true;

      console.log('[API] Migration to iCloud complete');
      return { success: true, path: libraryName, id };
    } catch (error) {
      console.error('[API] Failed to migrate to iCloud:', error);
      return { success: false, error: error.message };
    }
  },

  async registerLibraryLocal(options) {
    // On iOS, all libraries go to iCloud
    // This just registers the current local library for now
    return this.migrateLibraryToICloud(options);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PDF SETTINGS
  // ═══════════════════════════════════════════════════════════════════════════

  async getPdfZoom() {
    const result = await Preferences.get({ key: 'pdfZoom' });
    return result.value ? parseFloat(result.value) : 1.0;
  },

  async setPdfZoom(zoom) {
    await Preferences.set({ key: 'pdfZoom', value: String(zoom) });
  },

  async getPdfPositions() {
    const result = await Preferences.get({ key: 'pdfPositions' });
    return safeJsonParse(result.value) || {};
  },

  async setPdfPosition(paperId, position) {
    const positions = await this.getPdfPositions();
    positions[paperId] = position;
    await Preferences.set({ key: 'pdfPositions', value: JSON.stringify(positions) });
  },

  async getLastSelectedPaper() {
    const result = await Preferences.get({ key: 'lastSelectedPaperId' });
    return result.value ? parseInt(result.value) : null;
  },

  async setLastSelectedPaper(paperId) {
    await Preferences.set({ key: 'lastSelectedPaperId', value: String(paperId) });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADS SETTINGS
  // ═══════════════════════════════════════════════════════════════════════════

  async getAdsToken() {
    return await Keychain.getItem('adsToken');
  },

  async setAdsToken(token) {
    try {
      await Keychain.setItem('adsToken', token);
      return { success: true };
    } catch (error) {
      console.error('[API] Failed to save ADS token:', error);
      return { success: false, error: error.message };
    }
  },

  async getLibraryProxy() {
    const result = await Preferences.get({ key: 'libraryProxyUrl' });
    return result.value || '';
  },

  async setLibraryProxy(proxyUrl) {
    try {
      await Preferences.set({ key: 'libraryProxyUrl', value: proxyUrl });
      return { success: true };
    } catch (error) {
      console.error('[API] Failed to save library proxy:', error);
      return { success: false, error: error.message };
    }
  },

  async getPdfPriority() {
    const result = await Preferences.get({ key: 'pdfPriority' });
    return safeJsonParse(result.value) || ['EPRINT_PDF', 'PUB_PDF', 'ADS_PDF'];
  },

  async setPdfPriority(priority) {
    try {
      await Preferences.set({ key: 'pdfPriority', value: JSON.stringify(priority) });
      return { success: true };
    } catch (error) {
      console.error('[API] Failed to save PDF priority:', error);
      return { success: false, error: error.message };
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PAPER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async getAllPapers(options = {}) {
    try {
      if (!dbInitialized) await initializeDatabase();

      // Map sortBy to orderBy for database query
      const dbOptions = {
        orderBy: options.sortBy === 'date_added' ? 'added_date' : options.sortBy,
        order: options.sortOrder === 'desc' ? 'DESC' : 'ASC',
        search: options.search,
        readStatus: options.readStatus,
        collectionId: options.collectionId
      };

      const papers = MobileDB.getAllPapers(dbOptions);

      // Save database periodically
      await MobileDB.saveDatabase();

      return papers;
    } catch (error) {
      console.error('[API] getAllPapers error:', error);
      return [];
    }
  },

  async getPaper(id) {
    if (!dbInitialized) await initializeDatabase();
    return MobileDB.getPaper(id);
  },

  async updatePaper(id, updates) {
    try {
      if (!dbInitialized) await initializeDatabase();
      const success = MobileDB.updatePaper(id, updates);
      await MobileDB.saveDatabase();
      return { success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async deletePaper(id) {
    try {
      if (!dbInitialized) await initializeDatabase();

      // Get paper to find PDF path
      const paper = MobileDB.getPaper(id);
      if (paper && paper.pdf_path) {
        try {
          await Filesystem.deleteFile({
            path: `${LIBRARY_FOLDER}/${paper.pdf_path}`,
            directory: Directory.Documents
          });
        } catch (e) {
          // PDF may not exist
        }
      }

      const success = MobileDB.deletePaper(id);
      await MobileDB.saveDatabase();
      return { success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async deletePapersBulk(ids) {
    try {
      if (!dbInitialized) await initializeDatabase();
      for (const id of ids) {
        await this.deletePaper(id);
      }
      await MobileDB.saveDatabase();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async searchPapers(query) {
    try {
      if (!dbInitialized) await initializeDatabase();
      return MobileDB.getAllPapers({ search: query });
    } catch (error) {
      return [];
    }
  },

  async getPdfPath(relativePath) {
    // Return URI for PDF viewing
    try {
      // Add library folder prefix if not present
      const fullPath = relativePath.startsWith(LIBRARY_FOLDER)
        ? relativePath
        : `${LIBRARY_FOLDER}/${relativePath}`;

      const result = await Filesystem.getUri({
        path: fullPath,
        directory: Directory.Documents
      });
      return result.uri;
    } catch {
      return null;
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // COLLECTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async getCollections() {
    try {
      if (!dbInitialized) await initializeDatabase();
      return MobileDB.getCollections();
    } catch (error) {
      console.error('[API] getCollections error:', error);
      return [];
    }
  },

  async createCollection(name, parentId = null, isSmart = false, query = null) {
    try {
      if (!dbInitialized) await initializeDatabase();
      const id = MobileDB.createCollection(name, parentId);
      await MobileDB.saveDatabase();
      return { success: true, id };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async deleteCollection(collectionId) {
    try {
      if (!dbInitialized) await initializeDatabase();
      // TODO: Implement deleteCollection in MobileDB
      return { success: false, error: 'Not yet implemented' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async addPaperToCollection(paperId, collectionId) {
    try {
      if (!dbInitialized) await initializeDatabase();
      MobileDB.addPaperToCollection(paperId, collectionId);
      await MobileDB.saveDatabase();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async removePaperFromCollection(paperId, collectionId) {
    try {
      if (!dbInitialized) await initializeDatabase();
      MobileDB.removePaperFromCollection(paperId, collectionId);
      await MobileDB.saveDatabase();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async getPapersInCollection(collectionId) {
    try {
      if (!dbInitialized) await initializeDatabase();
      return MobileDB.getAllPapers({ collectionId });
    } catch (error) {
      return [];
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // REFERENCES & CITATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async getReferences(paperId) {
    return [];
  },

  async getCitations(paperId) {
    return [];
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADS API INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════

  async adsSearch(query, options = {}) {
    const token = await this.getAdsToken();
    if (!token) {
      return { success: false, error: 'ADS token not configured' };
    }
    // TODO: Implement with fetch
    return { success: false, error: 'ADS search not yet implemented for iOS' };
  },

  async adsGetEsources(bibcode) {
    try {
      const token = await Keychain.getItem('adsToken');
      if (!token) {
        return { success: false, error: 'No ADS API token configured' };
      }

      emit('consoleLog', { message: `Fetching PDF sources for ${bibcode}...`, level: 'info' });

      const esourcesUrl = `${ADS_API_BASE}/resolver/${bibcode}/esource`;
      const response = await CapacitorHttp.get({
        url: esourcesUrl,
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.status !== 200) {
        return { success: false, error: `ADS API error: ${response.status}` };
      }

      // Parse the esources response (various possible formats)
      let esources = [];
      const result = response.data;
      if (Array.isArray(result)) {
        esources = result;
      } else if (result && Array.isArray(result.links)) {
        esources = result.links;
      } else if (result && result.links && Array.isArray(result.links.records)) {
        esources = result.links.records;
      } else if (result && Array.isArray(result.records)) {
        esources = result.records;
      }

      emit('consoleLog', { message: `ADS returned ${esources.length} esource(s)`, level: 'info' });

      // Categorize sources by type
      const sources = {
        arxiv: null,
        ads: null,
        publisher: null
      };

      for (const source of esources) {
        const linkType = source.link_type || source.type || '';
        const url = source.url;

        if (!url || !url.startsWith('http')) continue;

        if (linkType.includes('EPRINT_PDF') && !sources.arxiv) {
          sources.arxiv = { url, type: 'EPRINT_PDF', label: 'arXiv' };
        } else if (linkType.includes('ADS_PDF') && !sources.ads) {
          sources.ads = { url, type: 'ADS_PDF', label: 'ADS Scan' };
        } else if (linkType.includes('PUB_PDF') && !sources.publisher) {
          sources.publisher = { url, type: 'PUB_PDF', label: 'Publisher' };
        }
      }

      return { success: true, data: sources };
    } catch (error) {
      console.error('[adsGetEsources] Error:', error);
      return { success: false, error: error.message };
    }
  },

  async downloadPdfFromSource(paperId, sourceType) {
    try {
      const paper = MobileDB.getPaper(paperId);
      if (!paper) {
        return { success: false, error: 'Paper not found' };
      }
      if (!paper.bibcode) {
        return { success: false, error: 'Paper has no bibcode' };
      }

      const token = await Keychain.getItem('adsToken');
      if (!token) {
        return { success: false, error: 'No ADS API token configured' };
      }

      emit('consoleLog', { message: `Downloading ${sourceType} PDF for ${paper.bibcode}...`, level: 'info' });

      // Ensure library folders exist
      await ensureLibraryExists();

      // Get esources
      const esourcesUrl = `${ADS_API_BASE}/resolver/${paper.bibcode}/esource`;
      const response = await CapacitorHttp.get({
        url: esourcesUrl,
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.status !== 200) {
        return { success: false, error: 'Failed to get PDF sources' };
      }

      // Parse esources
      let esources = [];
      const result = response.data;
      if (Array.isArray(result)) {
        esources = result;
      } else if (result && Array.isArray(result.links)) {
        esources = result.links;
      } else if (result && result.links && Array.isArray(result.links.records)) {
        esources = result.links.records;
      } else if (result && Array.isArray(result.records)) {
        esources = result.records;
      }

      // Map user-friendly type to ADS type
      const typeMap = {
        'arxiv': 'EPRINT_PDF',
        'ads': 'ADS_PDF',
        'publisher': 'PUB_PDF'
      };
      const adsType = typeMap[sourceType];
      if (!adsType) {
        return { success: false, error: `Unknown source type: ${sourceType}` };
      }

      // Find the requested source
      let targetSource = null;
      for (const source of esources) {
        const linkType = source.link_type || source.type || '';
        if (linkType.includes(adsType) && source.url && source.url.startsWith('http')) {
          targetSource = source;
          break;
        }
      }

      if (!targetSource) {
        emit('consoleLog', { message: `${sourceType} PDF not found in esources`, level: 'error' });
        return { success: false, error: `${sourceType} PDF not available` };
      }

      // Generate filename: bibcode_SOURCETYPE.pdf
      const baseFilename = paper.bibcode.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = `${baseFilename}_${adsType}.pdf`;
      const filePath = `${LIBRARY_FOLDER}/papers/${filename}`;

      // Check if already exists
      try {
        await Filesystem.stat({
          path: filePath,
          directory: Directory.Documents
        });
        emit('consoleLog', { message: `${sourceType} PDF already downloaded`, level: 'success' });
        const relativePath = `papers/${filename}`;

        // Update paper's pdf_path if not set
        if (!paper.pdf_path) {
          MobileDB.updatePaper(paperId, {
            pdf_path: relativePath,
            pdf_source: adsType
          });
        }

        return { success: true, pdf_path: relativePath, source: sourceType, alreadyExists: true };
      } catch (e) {
        // File doesn't exist, proceed with download
      }

      // For arXiv, construct direct PDF URL
      let pdfUrl = targetSource.url;
      if (sourceType === 'arxiv' && paper.arxiv_id) {
        pdfUrl = `https://arxiv.org/pdf/${paper.arxiv_id}.pdf`;
      }

      emit('consoleLog', { message: `Downloading from ${pdfUrl.substring(0, 50)}...`, level: 'info' });

      // Download the PDF
      const downloadResult = await Filesystem.downloadFile({
        url: pdfUrl,
        path: filePath,
        directory: Directory.Documents,
        progress: true
      });

      if (downloadResult.path) {
        const relativePath = `papers/${filename}`;

        // Update paper's pdf_path if not already set
        if (!paper.pdf_path) {
          MobileDB.updatePaper(paperId, {
            pdf_path: relativePath,
            pdf_source: adsType
          });
        }

        emit('consoleLog', { message: `${sourceType} PDF downloaded successfully`, level: 'success' });
        return { success: true, pdf_path: relativePath, source: sourceType };
      }

      return { success: false, error: 'Download failed' };
    } catch (error) {
      console.error('[downloadPdfFromSource] Error:', error);
      emit('consoleLog', { message: `Download failed: ${error.message}`, level: 'error' });
      return { success: false, error: error.message };
    }
  },

  async downloadPublisherPdf(paperId, publisherUrl, proxyUrl) {
    return { success: false, error: 'Not implemented for iOS' };
  },

  async checkPdfExists(paperId, sourceType) {
    return false;
  },

  async adsSyncPapers(paperIds) {
    return { success: false, error: 'Not implemented for iOS' };
  },

  async adsGetReferences(bibcode) {
    return { success: false, error: 'Not implemented for iOS' };
  },

  async adsGetCitations(bibcode) {
    return { success: false, error: 'Not implemented for iOS' };
  },

  async adsFetchMetadata(paperId) {
    return { success: false, error: 'Not implemented for iOS' };
  },

  async importSingleFromAds(adsDoc) {
    return { success: false, error: 'Not implemented for iOS' };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADS IMPORT SEARCH
  // ═══════════════════════════════════════════════════════════════════════════

  async adsImportSearch(query, options = {}) {
    try {
      console.log('[adsImportSearch] Starting search for:', query);

      const token = await Keychain.getItem('adsToken');
      console.log('[adsImportSearch] Token retrieved:', token ? 'yes' : 'no');

      if (!token) {
        return { success: false, error: 'No ADS API token configured. Please add your token in Settings.' };
      }

      const fields = 'bibcode,title,author,year,doi,abstract,keyword,pub,identifier,arxiv_class,citation_count';
      const rows = options.rows || 1000;
      const start = options.start || 0;
      const sort = options.sort || 'date desc';

      const params = new URLSearchParams({
        q: query,
        fl: fields,
        rows: rows.toString(),
        start: start.toString(),
        sort: sort
      });

      const url = `${ADS_API_BASE}/search/query?${params}`;
      console.log('[adsImportSearch] Fetching URL:', url);

      emit('consoleLog', { message: `ADS search: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`, level: 'info' });

      // Use CapacitorHttp for native HTTP requests (bypasses CORS on iOS)
      const response = await CapacitorHttp.get({
        url: url,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('[adsImportSearch] Response status:', response.status);

      if (response.status !== 200) {
        const errorText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        console.error('[adsImportSearch] API error response:', errorText);
        throw new Error(`ADS API error (${response.status}): ${errorText.substring(0, 200)}`);
      }

      const result = response.data;
      console.log('[adsImportSearch] Got response with', result.response?.numFound, 'results');

      const docs = result.response?.docs || [];
      const numFound = result.response?.numFound || 0;

      emit('consoleLog', { message: `ADS found ${numFound} results`, level: 'success' });

      // Load library papers to check for duplicates
      const libraryPapers = MobileDB.getAllPapers();
      const libraryBibcodes = new Set(libraryPapers.map(p => p.bibcode).filter(Boolean));

      // Convert to paper format
      const papers = docs.map(doc => {
        const paper = adsToPaper(doc);
        paper.inLibrary = libraryBibcodes.has(doc.bibcode);
        return paper;
      });

      return {
        success: true,
        data: {
          papers,
          numFound,
          start: result.response?.start || 0
        }
      };
    } catch (error) {
      console.error('[adsImportSearch] Error:', error);
      console.error('[adsImportSearch] Error name:', error.name);
      console.error('[adsImportSearch] Error message:', error.message);

      // Provide more helpful error messages
      let errorMessage = error.message;
      if (error.message === 'Load failed' || error.message.includes('Failed to fetch')) {
        errorMessage = 'Network error: Could not connect to ADS API. Check your internet connection.';
      } else if (error.message.includes('401')) {
        errorMessage = 'Invalid API token. Please check your ADS token in Settings.';
      }

      emit('consoleLog', { message: `ADS search failed: ${errorMessage}`, level: 'error' });
      return { success: false, error: errorMessage };
    }
  },

  async adsImportPapers(papers) {
    console.log('[adsImportPapers] Starting import of', papers.length, 'papers');

    // Emit initial progress immediately so UI knows we started
    emit('importProgress', {
      current: 0,
      total: papers.length,
      paper: 'Initializing...'
    });

    const results = {
      imported: [],
      skipped: [],
      failed: []
    };

    try {
      emit('consoleLog', { message: `ADS import: ${papers.length} papers selected`, level: 'info' });

      // Get token with timeout
      console.log('[adsImportPapers] Getting token...');
      let token = null;
      try {
        token = await Promise.race([
          Keychain.getItem('adsToken'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Token fetch timeout')), 5000))
        ]);
        console.log('[adsImportPapers] Token:', token ? 'present' : 'missing');
      } catch (e) {
        console.warn('[adsImportPapers] Token fetch failed:', e.message);
      }

      // Get PDF priority with fallback
      console.log('[adsImportPapers] Getting PDF priority...');
      let pdfPriority = ['EPRINT_PDF', 'PUB_PDF', 'ADS_PDF'];
      try {
        const storedPriority = await Promise.race([
          capacitorAPI.getPdfPriority(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Priority fetch timeout')), 3000))
        ]);
        if (storedPriority && Array.isArray(storedPriority)) {
          pdfPriority = storedPriority;
        }
        console.log('[adsImportPapers] PDF priority:', pdfPriority);
      } catch (e) {
        console.warn('[adsImportPapers] Using default PDF priority:', e.message);
      }

      for (let i = 0; i < papers.length; i++) {
        const paper = papers[i];
        console.log('[adsImportPapers] Processing paper', i + 1, ':', paper.bibcode);

        // Send progress update
        emit('importProgress', {
          current: i + 1,
          total: papers.length,
          paper: paper.title || paper.bibcode || 'Unknown'
        });

        try {
          // Skip if already in library
          if (paper.bibcode) {
            const existing = MobileDB.getPaperByBibcode(paper.bibcode);
            if (existing) {
              emit('consoleLog', { message: `[${paper.bibcode}] Already in library, skipping`, level: 'warn' });
              results.skipped.push({ paper, reason: 'Already in library' });
              continue;
            }
          }

          emit('consoleLog', { message: `[${paper.bibcode || 'unknown'}] Importing...`, level: 'info' });

          // Try to download PDF (don't let PDF failures block import)
          let pdfPath = null;
          let pdfSource = null;

          if (paper.bibcode && token) {
            try {
              console.log('[adsImportPapers] Attempting PDF download for', paper.bibcode);
              const downloadResult = await Promise.race([
                downloadPaperPdf(paper, token, pdfPriority),
                new Promise(resolve => setTimeout(() => resolve({ success: false, error: 'timeout' }), 30000))
              ]);
              console.log('[adsImportPapers] PDF download result:', downloadResult);
              if (downloadResult.success) {
                pdfPath = downloadResult.path;
                pdfSource = downloadResult.source;
                emit('consoleLog', { message: `[${paper.bibcode}] PDF downloaded (${pdfSource})`, level: 'success' });
              } else {
                emit('consoleLog', { message: `[${paper.bibcode}] No PDF available`, level: 'warn' });
              }
            } catch (pdfError) {
              console.warn('[adsImportPapers] PDF download error:', pdfError);
              emit('consoleLog', { message: `[${paper.bibcode}] PDF download failed`, level: 'warn' });
            }
          }

          // Add paper to storage
          console.log('[adsImportPapers] Adding paper to storage');
          const paperId = MobileDB.addPaper({
            bibcode: paper.bibcode,
            doi: paper.doi,
            arxiv_id: paper.arxiv_id,
            title: paper.title,
            authors: paper.authors,
            year: paper.year,
            journal: paper.journal,
            abstract: paper.abstract,
            keywords: paper.keywords,
            citation_count: paper.citation_count || 0,
            pdf_path: pdfPath,
            pdf_source: pdfSource
          });
          console.log('[adsImportPapers] Paper added with ID:', paperId);

          emit('consoleLog', { message: `[${paper.bibcode}] ✓ Imported`, level: 'success' });
          results.imported.push({
            paper,
            id: paperId,
            hasPdf: !!pdfPath,
            pdfSource
          });

        } catch (error) {
          console.error('[adsImportPapers] Paper import error:', error);
          emit('consoleLog', { message: `[${paper.bibcode || 'unknown'}] ✗ Import failed: ${error.message}`, level: 'error' });
          results.failed.push({ paper, error: error.message });
        }

        // Small delay between imports for rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      console.log('[adsImportPapers] Import complete. Results:', results);

      // Send completion
      emit('importComplete', results);

      return { success: true, results };
    } catch (error) {
      console.error('[adsImportPapers] Error:', error);
      emit('consoleLog', { message: `Import failed: ${error.message}`, level: 'error' });
      emit('importComplete', { imported: results.imported, skipped: results.skipped, failed: [...results.failed, ...papers.slice(results.imported.length + results.skipped.length + results.failed.length).map(p => ({ paper: p, error: error.message }))] });
      return { success: false, error: error.message };
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BIBTEX
  // ═══════════════════════════════════════════════════════════════════════════

  async copyCite(paperIds, style = 'cite') {
    return { success: false, error: 'Not implemented for iOS' };
  },

  async exportBibtex(paperIds) {
    return { success: false, error: 'Not implemented for iOS' };
  },

  async saveBibtexFile(content) {
    return { success: false, error: 'Not implemented for iOS' };
  },

  async importBibtex() {
    return { success: false, error: 'Not implemented for iOS' };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PDF IMPORT
  // ═══════════════════════════════════════════════════════════════════════════

  async importPDFs() {
    // TODO: Use Capacitor file picker
    return { success: false, error: 'PDF import not yet implemented for iOS' };
  },

  async selectPdfs() {
    return [];
  },

  async selectBibFile() {
    return null;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LOCAL LLM (Not available on iOS)
  // ═══════════════════════════════════════════════════════════════════════════

  async getLlmConfig() {
    return null;
  },

  async setLlmConfig(config) {
    return { success: false, error: 'Local LLM not available on iOS' };
  },

  async checkLlmConnection() {
    return { connected: false, error: 'Local LLM not available on iOS. Use Cloud API.' };
  },

  async listLlmModels() {
    return [];
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CLOUD LLM
  // ═══════════════════════════════════════════════════════════════════════════

  async getCloudLlmConfig() {
    const result = await Preferences.get({ key: 'cloudLlmConfig' });
    const config = safeJsonParse(result.value);
    if (!config) return null;

    const apiKey = await Keychain.getItem('cloudLlmApiKey');
    return { ...config, apiKey };
  },

  async setCloudLlmConfig(config) {
    if (config.apiKey) {
      await Keychain.setItem('cloudLlmApiKey', config.apiKey);
    }
    const { apiKey, ...rest } = config;
    await Preferences.set({ key: 'cloudLlmConfig', value: JSON.stringify(rest) });

    // Update service instance
    try {
      const { CloudLLMService } = await import('../main/cloud-llm-service.js');
      cloudLlmService = new CloudLLMService(config);
    } catch (e) {
      console.warn('[API] Failed to update cloud LLM service:', e);
    }

    return { success: true };
  },

  async getCloudLlmProviders() {
    return {
      anthropic: { name: 'Anthropic', models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'] },
      gemini: { name: 'Google Gemini', models: ['gemini-2.0-flash', 'gemini-1.5-pro'] },
      perplexity: { name: 'Perplexity', models: ['sonar', 'sonar-pro'] }
    };
  },

  async checkCloudLlmConnection() {
    const config = await this.getCloudLlmConfig();
    if (!config || !config.apiKey) {
      return { success: false, error: 'Cloud LLM not configured' };
    }
    // TODO: Actually test the connection
    return { success: true, provider: config.provider };
  },

  async getPreferredLlmType() {
    return 'cloud';
  },

  async setPreferredLlmType(type) {
    return { success: true };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LLM FEATURES
  // ═══════════════════════════════════════════════════════════════════════════

  async llmSummarize(paperId, options = {}) {
    return { success: false, error: 'Not yet implemented for iOS' };
  },

  async llmAsk(paperId, question) {
    return { success: false, error: 'Not yet implemented for iOS' };
  },

  async llmExplain(text, paperId) {
    return { success: false, error: 'Not yet implemented for iOS' };
  },

  async llmGenerateEmbeddings(paperId) {
    return { success: false, error: 'Not yet implemented for iOS' };
  },

  async llmGetUnindexedPapers() {
    return [];
  },

  async llmExtractMetadata(paperId) {
    return { success: false, error: 'Not yet implemented for iOS' };
  },

  async llmSemanticSearch(query, limit = 10) {
    return [];
  },

  async llmGetQAHistory(paperId) {
    return [];
  },

  async llmClearQAHistory(paperId) {
    return { success: true };
  },

  async llmDeleteSummary(paperId) {
    return { success: true };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ANNOTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async getAnnotations(paperId) {
    return [];
  },

  async getAnnotationCountsBySource(paperId) {
    return {};
  },

  async getDownloadedPdfSources(paperId) {
    try {
      const paper = MobileDB.getPaper(paperId);
      if (!paper || !paper.bibcode) {
        return [];
      }

      const baseFilename = paper.bibcode.replace(/[^a-zA-Z0-9._-]/g, '_');
      const downloadedSources = [];

      // Check for each source type: bibcode_SOURCETYPE.pdf
      const sourceTypes = ['EPRINT_PDF', 'PUB_PDF', 'ADS_PDF'];
      for (const sourceType of sourceTypes) {
        const filename = `${baseFilename}_${sourceType}.pdf`;
        const filePath = `${LIBRARY_FOLDER}/papers/${filename}`;

        try {
          await Filesystem.stat({
            path: filePath,
            directory: Directory.Documents
          });
          downloadedSources.push(sourceType);
        } catch (e) {
          // File doesn't exist
        }
      }

      return downloadedSources;
    } catch (error) {
      console.error('[getDownloadedPdfSources] Error:', error);
      return [];
    }
  },

  async deletePdf(paperId, sourceType) {
    try {
      const paper = MobileDB.getPaper(paperId);
      if (!paper || !paper.bibcode) {
        return { success: false, error: 'Paper not found' };
      }

      const baseFilename = paper.bibcode.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = `${baseFilename}_${sourceType}.pdf`;
      const filePath = `${LIBRARY_FOLDER}/papers/${filename}`;

      try {
        await Filesystem.deleteFile({
          path: filePath,
          directory: Directory.Documents
        });
        emit('consoleLog', { message: `Deleted ${sourceType} PDF for ${paper.bibcode}`, level: 'info' });

        // If this was the primary PDF, clear the pdf_path
        if (paper.pdf_source === sourceType) {
          MobileDB.updatePaper(paperId, {
            pdf_path: null,
            pdf_source: null
          });
        }

        return { success: true };
      } catch (e) {
        // File may not exist
        return { success: true };
      }
    } catch (error) {
      console.error('[deletePdf] Error:', error);
      return { success: false, error: error.message };
    }
  },

  async createAnnotation(paperId, data) {
    return { success: false, error: 'Not implemented for iOS' };
  },

  async updateAnnotation(id, data) {
    return { success: false, error: 'Not implemented for iOS' };
  },

  async deleteAnnotation(id) {
    return { success: false, error: 'Not implemented for iOS' };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  async openExternal(url) {
    window.open(url, '_blank');
  },

  async showInFinder(filePath) {
    // Not applicable on iOS
    return { success: false, error: 'Not available on iOS' };
  },

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async showSaveDialog(options) {
    return { canceled: true };
  },

  async writeFile(path, content) {
    try {
      await Filesystem.writeFile({
        path,
        data: content,
        directory: Directory.Documents,
        encoding: Encoding.UTF8
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT LISTENERS
  // ═══════════════════════════════════════════════════════════════════════════

  onConsoleLog(callback) {
    eventListeners.consoleLog.push(callback);
  },

  removeConsoleLogListeners() {
    eventListeners.consoleLog = [];
  },

  onAdsSyncProgress(callback) {
    eventListeners.adsSyncProgress.push(callback);
  },

  removeAdsSyncListeners() {
    eventListeners.adsSyncProgress = [];
  },

  onImportProgress(callback) {
    eventListeners.importProgress.push(callback);
  },

  onImportComplete(callback) {
    eventListeners.importComplete.push(callback);
  },

  removeImportListeners() {
    eventListeners.importProgress = [];
    eventListeners.importComplete = [];
  },

  onLlmStream(callback) {
    eventListeners.llmStream.push(callback);
  },

  removeLlmListeners() {
    eventListeners.llmStream = [];
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PLATFORM INFO
  // ═══════════════════════════════════════════════════════════════════════════

  platform: 'ios',
};

// Export emit function for internal use (e.g., when implementing features)
export { emit };
