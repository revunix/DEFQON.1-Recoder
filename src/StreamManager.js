const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class StreamManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.processes = {}; // Keyed by channelId
    this.reconnectTimeouts = {}; // Keyed by channelId
    this.ytDlpWrap = new YTDlpWrap();

    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }
  }

  isActive(channelId) {
    return !!this.processes[channelId];
  }

  start(stream) { // stream = { channelId, name, url }
    const { channelId, name, url } = stream;
    if (this.isActive(channelId)) {
      this.emit('log', `Stream ${name} (${channelId}) is already running.`);
      return;
    }

    if (this.reconnectTimeouts[channelId]) {
      clearTimeout(this.reconnectTimeouts[channelId]);
      delete this.reconnectTimeouts[channelId];
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
    const outFile = path.join(this.config.outputDir, `${safeName}-${timestamp}.mp3`);

    const args = [...this.config.ytdlpArgs, '-o', outFile, url];

    this.emit('log', `[${name}] Starting recording...`);

    try {
      const ytdlp = this.ytDlpWrap.exec(args);
      this.processes[channelId] = ytdlp;
      this.emit('stream:started', channelId);

      ytdlp.on('ytDlpEvent', (eventType, eventData) => {
        this.emit('log', `[${name}] ${eventData.trim()}`);
      });

      ytdlp.on('close', (code) => {
        this.emit('log', `[${name}] Process exited with code ${code}.`);
        this.handleReconnect(stream, `Process exited unexpectedly.`);
      });

      ytdlp.on('error', (err) => {
        this.handleReconnect(stream, `Failed to start process: ${err.message}`);
      });
    } catch (error) {
      this.handleReconnect(stream, `yt-dlp execution error: ${error.message}`);
    }
  }

  stop(channelId) {
    return new Promise((resolve) => {
      if (this.reconnectTimeouts[channelId]) {
        clearTimeout(this.reconnectTimeouts[channelId]);
        delete this.reconnectTimeouts[channelId];
      }

      const process = this.processes[channelId];
      if (process) {
        this.emit('log', `[${channelId}] Stopping recording...`);

        // Remove listeners to prevent reconnect logic on clean exit
        process.removeAllListeners('close');
        process.removeAllListeners('error');
        process.removeAllListeners('ytDlpEvent');

        // Resolve promise on close
        process.once('close', () => {
          this.emit('log', `[${channelId}] Process stopped successfully.`);
          delete this.processes[channelId];
          this.emit('stream:stopped', channelId);
          resolve();
        });

        // Gracefully terminate
        process.kill('SIGINT');
        
        // Failsafe timeout
        setTimeout(() => {
            if (this.processes[channelId]) {
                this.emit('log', `[${channelId}] Process did not respond to SIGINT. Forcing kill.`);
                process.kill('SIGKILL');
            }
        }, 5000); // 5 second timeout

      } else {
        resolve(); // No process to stop
      }
    });
  }

  handleReconnect(stream, reason) {
    const { channelId, name } = stream;
    if (this.processes[channelId]) {
      delete this.processes[channelId];
    }

    this.emit('stream:error', channelId, reason);

    // Reconnect is now handled by the polling logic in App.js
    // This function now only cleans up and emits an error.
    this.emit('log', `[${name}] Connection lost. API polling will handle reconnect.`);
  }

  async stopAll() {
    this.emit('log', 'Stopping all stream processes...');
    const stopPromises = Object.keys(this.processes).map(channelId => this.stop(channelId));
    await Promise.all(stopPromises);
    this.emit('log', 'All stream processes have been stopped.');
  }
}

module.exports = StreamManager;
