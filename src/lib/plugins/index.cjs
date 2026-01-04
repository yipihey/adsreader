/**
 * Plugin System Entry Point
 *
 * Exports all plugin-related types and the singleton manager instance.
 */

'use strict';

const types = require('./types.cjs');
const { PluginManager, pluginManager } = require('./manager.cjs');

module.exports = {
  // Types and factories
  ...types,

  // Manager
  PluginManager,
  pluginManager
};
