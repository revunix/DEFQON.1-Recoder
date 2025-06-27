import { spawn } from 'child_process';
import { mkdir, stat } from 'fs/promises';
import path from 'path';
import blessed from 'blessed';
import contrib from 'blessed-contrib';

const API_BASE_URL = 'https://apicdn.mixlr.com/v3/channel_view/';
const CHANNELS = [
  "defqon-1-magenta",
  "defqon1purple",
  "defqon1white",
  "defqon-1-brown",
  "defqon1pink",
  "defqon1blue",
  "defqon1indigo",
  "defqon1yellow",
  "defqon1orange",
  "defqon1silver",
  "defqon1green",
  "defqon1gold",
  "defqon1black",
  "defqon1uv"
];

const RECORDINGS_DIR = 'recordings';
const CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds
const STALLED_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
const STALLED_TIMEOUT_MS = 60 * 1000; // 1 minute
const TUI_UPDATE_INTERVAL_MS = 2 * 1000; // 2 seconds

// TUI Elements
const screen = blessed.screen();
const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });
const recordingsTable = grid.set(0, 0, 8, 12, contrib.table, {
  keys: true,
  fg: 'white',
  selectedFg: 'white',
  selectedBg: 'blue',
  interactive: true,
  label: 'Live Recordings',
  width: '100%',
  height: '100%',
  border: { type: 'line', fg: 'cyan' },
  columnSpacing: 10,
  columnWidth: [30, 50, 20]
});
const logOutput = grid.set(8, 0, 4, 12, contrib.log, {
  fg: "green",
  selectedFg: "green",
  label: 'Logs'
});

// Redirect console to log widget
console.log = (d) => logOutput.log(d);
console.error = (d) => logOutput.log(`{red-fg}${d}{/red-fg}`);
console.warn = (d) => logOutput.log(`{yellow-fg}${d}{/yellow-fg}`);

// Keep track of running processes
const runningProcesses = new Map();
let intervals = [];
let isShuttingDown = false;

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function fetchStreamInfo(channel) {
  try {
    const response = await fetch(`${API_BASE_URL}${channel}`);
    if (!response.ok) {
      console.error(`[${channel}] Error fetching API: ${response.statusText}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`[${channel}] Error fetching data:`, error);
    return null;
  }
}

function findLiveBroadcast(data) {
    if (!data?.data?.relationships?.current_broadcast?.data || !data.included) {
        return null;
    }
    const currentBroadcastId = data.data.relationships.current_broadcast.data.id;
    const broadcast = data.included.find(item => item.type === 'broadcast' && item.id === currentBroadcastId);
    if (broadcast?.attributes?.live && broadcast.attributes.progressive_stream_url) {
        return {
            stage: data.data.attributes.username,
            streamUrl: broadcast.attributes.progressive_stream_url
        };
    }
    return null;
}

function recordStream(stage, streamUrl) {
  if (runningProcesses.has(stage)) return;

  const fileName = `${stage}_${new Date().toISOString().replace(/[\/:]/g, '-')}.mp3`;
  const outputPath = path.join(RECORDINGS_DIR, fileName);

  console.log(`[${stage}] Starting recording...`);

  const ytdlp = spawn('yt-dlp', ['--no-part', '-f', 'bestaudio', '--extract-audio', '--audio-format', 'mp3', '--live-from-start', '-o', outputPath, streamUrl], { stdio: 'pipe' });

  runningProcesses.set(stage, { process: ytdlp, path: outputPath, lastSize: 0, lastCheck: Date.now(), fileName });

  ytdlp.stderr.on('data', (data) => {
    const message = data.toString().trim();
    if (!isShuttingDown && message.toLowerCase().includes('error')) {
        console.error(`[${stage}] yt-dlp: ${message}`);
    }
  });

  ytdlp.on('close', (code) => {
    if (!isShuttingDown) console.log(`[${stage}] Recording finished (code ${code}).`);
    runningProcesses.delete(stage);
  });

  ytdlp.on('error', (err) => {
      console.error(`[${stage}] Failed to start yt-dlp: ${err.message}`);
      runningProcesses.delete(stage);
  });
}

async function monitorStalledRecordings() {
    for (const [stage, info] of runningProcesses.entries()) {
        try {
            const stats = await stat(info.path);
            if (stats.size > info.lastSize) {
                info.lastSize = stats.size;
                info.lastCheck = Date.now();
            } else if (Date.now() - info.lastCheck > STALLED_TIMEOUT_MS) {
                console.warn(`[${stage}] Recording stalled. Restarting...`);
                info.process.kill('SIGKILL');
                runningProcesses.delete(stage);
            }
        } catch (error) {
            if (error.code !== 'ENOENT') console.error(`[${stage}] Stat error: ${error.message}`);
        }
    }
}

async function checkChannels() {
  console.log(`--- Checking channels at ${new Date().toLocaleTimeString()} ---`);
  for (const channel of CHANNELS) {
    const streamData = await fetchStreamInfo(channel);
    const stageName = streamData?.data?.attributes?.username || channel;
    if (streamData) {
        const liveBroadcast = findLiveBroadcast(streamData);
        if (liveBroadcast) {
            recordStream(liveBroadcast.stage, liveBroadcast.streamUrl);
        } else if (runningProcesses.has(stageName)) {
            console.log(`[${stageName}] Stream offline. Stopping recording.`);
            runningProcesses.get(stageName).process.kill();
            runningProcesses.delete(stageName);
        }
    }
  }
}

async function updateTuiTable() {
    const tableData = [];
    for (const [stage, info] of runningProcesses.entries()) {
        let size = 'N/A';
        try {
            const stats = await stat(info.path);
            size = formatBytes(stats.size);
        } catch (e) { /* ignore if file not found */ }
        tableData.push([stage, info.fileName, size]);
    }
    recordingsTable.setData({ headers: ['Stage', 'File Name', 'Size'], data: tableData });
    screen.render();
}

function gracefulShutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('--- Gracefully shutting down ---');
    intervals.forEach(clearInterval);
    const promises = [];
    for (const [stage, info] of runningProcesses.entries()) {
        console.log(`Stopping recording for ${stage}...`);
        const p = new Promise(resolve => info.process.on('close', resolve));
        promises.push(p);
        info.process.kill('SIGINT');
    }

    Promise.all(promises).then(() => {
        screen.destroy();
        process.exit(0);
    });
}

async function main() {
  screen.key(['escape', 'q', 'C-c'], gracefulShutdown);
  recordingsTable.focus();
  screen.render();

  console.log('--- Starting Stream Recorder ---');
  try {
    await mkdir(RECORDINGS_DIR, { recursive: true });
    console.log(`Recordings saved in: ${path.resolve(RECORDINGS_DIR)}`);
  } catch (error) {
    console.error(`Could not create recordings directory: ${error.message}`);
    return;
  }

  await checkChannels();
  intervals.push(setInterval(checkChannels, CHECK_INTERVAL_MS));
  intervals.push(setInterval(monitorStalledRecordings, STALLED_CHECK_INTERVAL_MS));
  intervals.push(setInterval(updateTuiTable, TUI_UPDATE_INTERVAL_MS));
}

main();
