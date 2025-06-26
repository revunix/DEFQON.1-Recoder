const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const UIManager = require('./UIManager');
const StreamManager = require('./StreamManager');
const ApiManager = require('./ApiManager');

class App {
  constructor(config) {
    this.config = config;
    this.channelIds = [];
    this.streamStates = {}; // Keyed by channelId

    this.ui = new UIManager();
    this.streamManager = new StreamManager(config);
    this.apiManager = new ApiManager();

    this.pollingInterval = 10000; // 10 seconds
    this.bindEvents();
  }

  start() {
    try {
      this.ui.log('App starting with API polling...');
      this.loadChannelIds();
      this.watchStreamsFile();

      // Initialer Poll
      this.pollStreams().catch(err => {
        this.ui.logError(`Initial poll failed: ${err.message}`);
      });
      
      // Regelmäßige Polls
      this.pollingIntervalId = setInterval(() => {
        this.pollStreams().catch(err => {
          this.ui.logError(`Polling error: ${err.message}`);
        });
      }, this.pollingInterval);
      
      // UI-Update-Intervall
      this.uiUpdateIntervalId = setInterval(() => this.updateUi(), 1000);
      
      // Tastatur-Handler für direkte Steuerung
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', (key) => {
        const keyStr = key.toString();
        if (keyStr === 'q' || keyStr === '\u0003') { // q oder Strg+C
          this.ui.log('Quit requested via keyboard...');
          this.shutdown(0);
        }
      });
      
      this.ui.log('App started successfully');
    } catch (error) {
      this.ui.logError(`Failed to start app: ${error.message}`);
      throw error;
    }
  }

  bindEvents() {
    this.ui.on('quit', () => this.shutdown());
    // No more toggleStream, it's automatic now

    this.streamManager.on('stream:started', (channelId) => {
      if (this.streamStates[channelId]) {
        this.streamStates[channelId].status = 'recording';
        this.streamStates[channelId].startTime = Date.now();
      }
      this.updateUi();
    });

    this.streamManager.on('stream:stopped', (channelId) => {
      if (this.streamStates[channelId]) {
        // Stream stopped, could be due to API status change or error.
        // Polling will determine the correct new state (live or offline).
        this.streamStates[channelId].status = 'offline';
      }
      this.updateUi();
    });

    this.streamManager.on('stream:error', (channelId, errorMessage) => {
      if (this.streamStates[channelId]) {
        this.streamStates[channelId].status = 'error';
      }
      this.ui.logError(`[${this.streamStates[channelId]?.name || channelId}] ${errorMessage}`);
      this.updateUi();
    });

    this.streamManager.on('log', (msg) => this.ui.log(msg));
  }

  loadChannelIds() {
    try {
      const streamsFilePath = path.isAbsolute(this.config.streamsFile)
        ? this.config.streamsFile
        : path.join(__dirname, '..', this.config.streamsFile);

      const newChannelIds = JSON.parse(fs.readFileSync(streamsFilePath, 'utf8'));
      this.ui.log(`Loaded ${newChannelIds.length} channels from ${this.config.streamsFile}.`);

      // Remove streams that are no longer in the list
      Object.keys(this.streamStates).forEach(channelId => {
        if (!newChannelIds.includes(channelId)) {
          this.streamManager.stop(channelId);
          delete this.streamStates[channelId];
        }
      });

      // Add new streams
      newChannelIds.forEach(channelId => {
        if (!this.streamStates[channelId]) {
          this.streamStates[channelId] = { status: 'offline', name: channelId, channelId };
        }
      });

      this.channelIds = newChannelIds;
      this.updateUi();
    } catch (err) {
      this.ui.logError(`Failed to load streams file: ${err.message}`);
    }
  }

  watchStreamsFile() {
    const streamsFilePath = path.isAbsolute(this.config.streamsFile)
      ? this.config.streamsFile
      : path.join(__dirname, '..', this.config.streamsFile);
    const watcher = chokidar.watch(streamsFilePath, { persistent: true });
    watcher.on('change', () => {
      this.ui.log('streams.json changed, reloading...');
      this.loadChannelIds();
    });
  }

  async pollStreams() {
    this.ui.log('Polling APIs for live status...');
    for (const channelId of this.channelIds) {
      const state = this.streamStates[channelId];
      const info = await this.apiManager.getStreamInfo(channelId);

      // Update name if it has changed
      state.name = info.name;

      if (info.live) {
        state.status = 'live';
        state.listenerCount = info.listenerCount || 0;
        if (state.status !== 'recording' && !this.streamManager.isActive(channelId)) {
          this.ui.log(`[${state.name}] is live! Starting recording... (${state.listenerCount} listeners)`);
          this.streamManager.start({ name: state.name, url: info.url, channelId: channelId });
        }
      } else {
        state.status = 'offline';
        state.listenerCount = 0;
        if (this.streamManager.isActive(channelId)) {
          this.ui.log(`[${state.name}] is now offline. Stopping recording.`);
          this.streamManager.stop(channelId);
        }
      }

      if (info.error) {
        state.status = 'error';
        this.ui.logError(`[${state.name}] API Error: ${info.error}`);
      }
    }
    this.updateUi();
  }

  updateUi() {
    const streamsForUi = Object.values(this.streamStates);
    this.ui.updateStreamsList(streamsForUi, this.streamStates);
    this.ui.updateStatus(streamsForUi, this.streamStates);
  }

  async shutdown(exitCode = 0) {
    try {
      this.ui.log('Shutting down, stopping all streams...');
      
      // Clear all intervals
      if (this.pollingIntervalId) {
        clearInterval(this.pollingIntervalId);
        this.pollingIntervalId = null;
      }
      
      if (this.uiUpdateIntervalId) {
        clearInterval(this.uiUpdateIntervalId);
        this.uiUpdateIntervalId = null;
      }

      // Stop all streams with a timeout
      this.ui.log('Stopping all recording streams...');
      try {
        await Promise.race([
          this.streamManager.stopAll(),
          new Promise(resolve => setTimeout(() => {
            this.ui.log('Warning: Timeout while waiting for streams to stop');
            resolve();
          }, 10000)) // 10s timeout
        ]);
      } catch (error) {
        this.ui.logError(`Error stopping streams: ${error.message}`);
        exitCode = 1;
      }
      
      this.ui.log('All stream processes have been shut down.');
      
      // Final render to show the last messages
      try {
        this.ui.render();
        // Give a moment for final logs to be seen
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e) {
        console.error('Error during final render:', e);
      }
      
    } catch (error) {
      console.error('FATAL: Error during shutdown:', error);
      exitCode = 1;
    } finally {
      try {
        // Clean up UI
        if (this.ui) {
          this.ui.destroy();
        }
        // Clean up stdin
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
          process.stdin.pause();
        }
      } catch (e) {
        console.error('Error during cleanup:', e);
      } finally {
        // Ensure process exits
        process.exit(exitCode);
      }
    }
  }
}

module.exports = App;
