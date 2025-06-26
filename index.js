const fs = require('fs');
const path = require('path');
const App = require('./src/App');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function main() {
  console.log('[1/7] Starting Advanced Stream Recorder...');

  // 1. Load config
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`FATAL: Configuration file not found at ${CONFIG_PATH}`);
    return process.exit(1);
  }
  console.log('[2/7] Config file found.');
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  console.log('[3/7] Configuration loaded successfully.');

  // 2. Check streams.json
  const streamsFilePath = path.isAbsolute(config.streamsFile)
    ? config.streamsFile
    : path.join(__dirname, config.streamsFile);

  if (!fs.existsSync(streamsFilePath)) {
    console.error(`FATAL: Streams file not found at ${streamsFilePath}`);
    console.error('Please create it.');
    return process.exit(1);
  }
  console.log('[4/7] Streams file found.');

  // 3. Start the application
  try {
    console.log('[5/7] Initializing App...');
    const app = new App(config);
    console.log('[6/7] App initialized. Starting...');
    app.start();
    console.log('[7/7] App start method called. Running...');
  } catch (err) {
    console.error('An unexpected error occurred during app initialization:', err.stack);
    process.exit(1);
  }
}

main();

