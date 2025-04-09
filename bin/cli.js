#!/usr/bin/env node

/**
 * CLI script for starting the Google Analytics 4 Data MCP server
 */

// Check if .env file exists and load it, but don't require it
const fs = require('fs');
const path = require('path');
const envPath = path.resolve(process.cwd(), '.env');

if (!fs.existsSync(envPath)) {
  // .env file is optional, silently continue using environment variables
}

// Start the MCP server
console.error('Starting Google Analytics 4 Data MCP Server...');
require('../dist/index.js');
