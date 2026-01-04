/**
 * Plugin Manager
 *
 * Central registry for source plugins. Handles:
 * - Plugin registration and discovery
 * - Active plugin selection
 * - Unified search across plugins
 * - Rate limit coordination
 */

'use strict';

const EventEmitter = require('events');
const { validatePlugin } = require('./types.cjs');

class PluginManager extends EventEmitter {
  constructor() {
    super();

    /** @type {Map<string, import('./types.cjs').PluginRegistration>} */
    this.plugins = new Map();

    /** @type {string|null} */
    this.activePluginId = null;

    /** @type {Map<string, number>} */
    this.lastRequestTime = new Map();
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  /**
   * Register a source plugin
   * @param {import('./types.cjs').SourcePlugin} plugin - Plugin to register
   * @throws {Error} If plugin is invalid or ID already registered
   */
  register(plugin) {
    // Validate plugin structure
    const validation = validatePlugin(plugin);
    if (!validation.valid) {
      throw new Error(`Invalid plugin "${plugin.id}": ${validation.errors.join(', ')}`);
    }

    // Check for duplicate
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered`);
    }

    // Register
    this.plugins.set(plugin.id, {
      id: plugin.id,
      plugin,
      enabled: true,
      registeredAt: new Date()
    });

    console.log(`[PluginManager] Registered plugin: ${plugin.id} (${plugin.name})`);
    this.emit('plugin:registered', { pluginId: plugin.id, plugin });

    // Set as active if it's the first plugin
    if (this.activePluginId === null) {
      this.setActive(plugin.id);
    }
  }

  /**
   * Unregister a plugin
   * @param {string} pluginId - Plugin ID to unregister
   */
  async unregister(pluginId) {
    const registration = this.plugins.get(pluginId);
    if (!registration) {
      throw new Error(`Plugin "${pluginId}" is not registered`);
    }

    // Call shutdown if available
    if (typeof registration.plugin.shutdown === 'function') {
      try {
        await registration.plugin.shutdown();
      } catch (err) {
        console.error(`[PluginManager] Error shutting down plugin ${pluginId}:`, err);
      }
    }

    this.plugins.delete(pluginId);
    this.emit('plugin:unregistered', { pluginId });

    // Clear active if this was the active plugin
    if (this.activePluginId === pluginId) {
      const remaining = this.list();
      this.activePluginId = remaining.length > 0 ? remaining[0].id : null;
    }

    console.log(`[PluginManager] Unregistered plugin: ${pluginId}`);
  }

  // ==========================================================================
  // Plugin Access
  // ==========================================================================

  /**
   * Get a plugin by ID
   * @param {string} pluginId - Plugin ID
   * @returns {import('./types.cjs').SourcePlugin|null}
   */
  get(pluginId) {
    const registration = this.plugins.get(pluginId);
    return registration?.plugin || null;
  }

  /**
   * Get the currently active plugin
   * @returns {import('./types.cjs').SourcePlugin|null}
   */
  getActive() {
    if (!this.activePluginId) return null;
    return this.get(this.activePluginId);
  }

  /**
   * Set the active plugin
   * @param {string} pluginId - Plugin ID to make active
   */
  setActive(pluginId) {
    if (!this.plugins.has(pluginId)) {
      throw new Error(`Plugin "${pluginId}" is not registered`);
    }

    const previous = this.activePluginId;
    this.activePluginId = pluginId;

    console.log(`[PluginManager] Active plugin changed: ${previous} -> ${pluginId}`);
    this.emit('plugin:active-changed', { previous, current: pluginId });
  }

  /**
   * List all registered plugins
   * @param {Object} [options] - Filter options
   * @param {boolean} [options.enabledOnly=false] - Only return enabled plugins
   * @param {string} [options.capability] - Only return plugins with this capability
   * @returns {import('./types.cjs').SourcePlugin[]}
   */
  list(options = {}) {
    const { enabledOnly = false, capability } = options;

    return Array.from(this.plugins.values())
      .filter(reg => {
        if (enabledOnly && !reg.enabled) return false;
        if (capability && !reg.plugin.capabilities[capability]) return false;
        return true;
      })
      .map(reg => reg.plugin);
  }

  /**
   * Get plugin info for UI display
   * @returns {Array<{id: string, name: string, icon: string, active: boolean, capabilities: Object}>}
   */
  getPluginInfo() {
    return Array.from(this.plugins.values()).map(reg => ({
      id: reg.plugin.id,
      name: reg.plugin.name,
      icon: reg.plugin.icon || '',
      description: reg.plugin.description || '',
      active: reg.plugin.id === this.activePluginId,
      enabled: reg.enabled,
      capabilities: reg.plugin.capabilities,
      auth: {
        type: reg.plugin.auth.type,
        required: reg.plugin.auth.type !== 'none'
      }
    }));
  }

  // ==========================================================================
  // Enable/Disable
  // ==========================================================================

  /**
   * Enable a plugin
   * @param {string} pluginId - Plugin ID
   */
  enable(pluginId) {
    const registration = this.plugins.get(pluginId);
    if (!registration) {
      throw new Error(`Plugin "${pluginId}" is not registered`);
    }

    registration.enabled = true;
    this.emit('plugin:enabled', { pluginId });
  }

  /**
   * Disable a plugin
   * @param {string} pluginId - Plugin ID
   */
  disable(pluginId) {
    const registration = this.plugins.get(pluginId);
    if (!registration) {
      throw new Error(`Plugin "${pluginId}" is not registered`);
    }

    registration.enabled = false;
    this.emit('plugin:disabled', { pluginId });

    // Switch active if this was active
    if (this.activePluginId === pluginId) {
      const enabled = this.list({ enabledOnly: true });
      this.activePluginId = enabled.length > 0 ? enabled[0].id : null;
    }
  }

  // ==========================================================================
  // Unified Operations
  // ==========================================================================

  /**
   * Search using the active plugin
   * @param {import('./types.cjs').UnifiedQuery} query - Search query
   * @returns {Promise<import('./types.cjs').SearchResult>}
   */
  async search(query) {
    const plugin = this.getActive();
    if (!plugin) {
      throw new Error('No active plugin');
    }
    if (!plugin.capabilities.search) {
      throw new Error(`Plugin "${plugin.id}" does not support search`);
    }

    await this._enforceRateLimit(plugin.id);

    const result = await plugin.search(query);

    // Tag results with source
    result.papers = result.papers.map(p => ({
      ...p,
      source: plugin.id
    }));

    return result;
  }

  /**
   * Search across all enabled plugins (federated search)
   * @param {import('./types.cjs').UnifiedQuery} query - Search query
   * @returns {Promise<{results: Map<string, import('./types.cjs').SearchResult>, errors: Map<string, Error>}>}
   */
  async federatedSearch(query) {
    const searchPlugins = this.list({ enabledOnly: true, capability: 'search' });

    const results = new Map();
    const errors = new Map();

    await Promise.allSettled(
      searchPlugins.map(async plugin => {
        try {
          await this._enforceRateLimit(plugin.id);
          const result = await plugin.search(query);

          // Tag results with source
          result.papers = result.papers.map(p => ({
            ...p,
            source: plugin.id
          }));

          results.set(plugin.id, result);
        } catch (err) {
          errors.set(plugin.id, err);
        }
      })
    );

    return { results, errors };
  }

  /**
   * Lookup a paper by identifier across all plugins
   * @param {string} identifier - DOI, arXiv ID, bibcode, etc.
   * @returns {Promise<import('./types.cjs').Paper|null>}
   */
  async lookup(identifier) {
    // Detect identifier type
    const idType = this._detectIdentifierType(identifier);

    // Get plugins that support lookup
    const lookupPlugins = this.list({ enabledOnly: true, capability: 'lookup' });

    // Try active plugin first
    const active = this.getActive();
    if (active && active.capabilities.lookup) {
      try {
        const paper = await this._lookupWithPlugin(active, identifier, idType);
        if (paper) return paper;
      } catch (err) {
        console.warn(`[PluginManager] Lookup failed with ${active.id}:`, err.message);
      }
    }

    // Try other plugins
    for (const plugin of lookupPlugins) {
      if (plugin.id === active?.id) continue; // Already tried

      try {
        const paper = await this._lookupWithPlugin(plugin, identifier, idType);
        if (paper) return paper;
      } catch (err) {
        console.warn(`[PluginManager] Lookup failed with ${plugin.id}:`, err.message);
      }
    }

    return null;
  }

  /**
   * Get PDF sources from appropriate plugin
   * @param {import('./types.cjs').Paper} paper - Paper object
   * @returns {Promise<import('./types.cjs').PdfSource[]>}
   */
  async getPdfSources(paper) {
    // Get plugin that provided this paper
    const plugin = this.get(paper.source);
    if (plugin && plugin.capabilities.pdfDownload) {
      return plugin.getPdfSources(paper.sourceId);
    }

    // Fallback: try all plugins with PDF capability
    const pdfPlugins = this.list({ enabledOnly: true, capability: 'pdfDownload' });
    const allSources = [];

    for (const p of pdfPlugins) {
      try {
        const sources = await p.getPdfSources(paper.sourceId);
        allSources.push(...sources);
      } catch (err) {
        // Ignore - this plugin may not recognize the paper
      }
    }

    return allSources;
  }

  // ==========================================================================
  // Rate Limiting
  // ==========================================================================

  /**
   * Enforce rate limiting for a plugin
   * @param {string} pluginId - Plugin ID
   * @private
   */
  async _enforceRateLimit(pluginId) {
    const plugin = this.get(pluginId);
    if (!plugin) return;

    const status = plugin.getRateLimitStatus?.();
    if (!status) return;

    // If rate limited, wait
    if (status.remaining <= 0 && status.retryAfter) {
      console.log(`[PluginManager] Rate limited by ${pluginId}, waiting ${status.retryAfter}s`);
      await new Promise(resolve => setTimeout(resolve, status.retryAfter * 1000));
    }

    // Minimum delay between requests (plugin-specific)
    const minDelay = this._getMinDelay(pluginId);
    const lastRequest = this.lastRequestTime.get(pluginId) || 0;
    const elapsed = Date.now() - lastRequest;

    if (elapsed < minDelay) {
      await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
    }

    this.lastRequestTime.set(pluginId, Date.now());
  }

  /**
   * Get minimum delay between requests for a plugin
   * @param {string} pluginId - Plugin ID
   * @returns {number} Delay in milliseconds
   * @private
   */
  _getMinDelay(pluginId) {
    // Plugin-specific delays based on their rate limit policies
    const delays = {
      'ads': 50,      // ADS: 5000/day, fairly generous
      'arxiv': 3000,  // arXiv: Recommends 3s between requests
      'inspire': 350, // INSPIRE: 15 requests per 5s = 333ms
      'default': 100
    };
    return delays[pluginId] || delays.default;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Detect the type of identifier
   * @param {string} identifier
   * @returns {'doi'|'arxiv'|'bibcode'|'inspire'|'unknown'}
   * @private
   */
  _detectIdentifierType(identifier) {
    const id = identifier.trim();

    // DOI: 10.xxxx/...
    if (/^10\.\d{4,}\//.test(id)) return 'doi';

    // arXiv: YYMM.NNNNN or archive/YYMMNNN
    if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(id) || /^[a-z-]+\/\d{7}$/.test(id)) return 'arxiv';

    // Bibcode: 19 characters, starts with year
    if (/^\d{4}[A-Za-z&.]{5}[A-Za-z0-9.]{9}[A-Z.]$/.test(id)) return 'bibcode';

    // INSPIRE: Numeric record ID
    if (/^\d+$/.test(id) && id.length < 10) return 'inspire';

    return 'unknown';
  }

  /**
   * Lookup with a specific plugin based on identifier type
   * @param {import('./types.cjs').SourcePlugin} plugin
   * @param {string} identifier
   * @param {string} idType
   * @returns {Promise<import('./types.cjs').Paper|null>}
   * @private
   */
  async _lookupWithPlugin(plugin, identifier, idType) {
    await this._enforceRateLimit(plugin.id);

    switch (idType) {
      case 'doi':
        if (plugin.getByDOI) {
          return plugin.getByDOI(identifier);
        }
        break;

      case 'arxiv':
        if (plugin.getByArxiv) {
          return plugin.getByArxiv(identifier);
        }
        break;

      case 'bibcode':
        // Bibcodes are ADS-specific, but try direct lookup
        if (plugin.id === 'ads') {
          return plugin.getRecord(identifier);
        }
        break;

      case 'inspire':
        if (plugin.id === 'inspire') {
          return plugin.getRecord(identifier);
        }
        break;
    }

    // Fallback: try generic getRecord
    return plugin.getRecord(identifier);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize all registered plugins
   */
  async initialize() {
    const initPromises = Array.from(this.plugins.values())
      .filter(reg => typeof reg.plugin.initialize === 'function')
      .map(async reg => {
        try {
          await reg.plugin.initialize();
          console.log(`[PluginManager] Initialized plugin: ${reg.id}`);
        } catch (err) {
          console.error(`[PluginManager] Failed to initialize ${reg.id}:`, err);
          reg.enabled = false;
        }
      });

    await Promise.all(initPromises);
    this.emit('initialized');
  }

  /**
   * Shutdown all plugins
   */
  async shutdown() {
    const shutdownPromises = Array.from(this.plugins.values())
      .filter(reg => typeof reg.plugin.shutdown === 'function')
      .map(async reg => {
        try {
          await reg.plugin.shutdown();
        } catch (err) {
          console.error(`[PluginManager] Error shutting down ${reg.id}:`, err);
        }
      });

    await Promise.all(shutdownPromises);
    this.plugins.clear();
    this.activePluginId = null;
    this.emit('shutdown');
  }
}

// Singleton instance
const pluginManager = new PluginManager();

module.exports = {
  PluginManager,
  pluginManager
};
