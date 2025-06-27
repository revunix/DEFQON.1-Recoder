import { spawn } from 'child_process';
import { mkdir, stat } from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import blessed from 'blessed';
import contrib from 'blessed-contrib';

const API_BASE_URL = 'https://apicdn.mixlr.com/v3/channel_view/';
const CHANNELS = [
  "defqon-1-magenta", "defqon1purple", "defqon1white", "defqon-1-brown",
  "defqon1pink", "defqon1blue", "defqon1indigo", "defqon1yellow",
  "defqon1orange", "defqon1silver", "defqon1green", "defqon1gold",
  "defqon1black", "defqon1uv"
];

const RECORDINGS_DIR = 'recordings';
const CHECK_INTERVAL_MS = 60 * 1000;
const STALLED_CHECK_INTERVAL_MS = 30 * 1000;
const STALLED_TIMEOUT_MS = 60 * 1000;
const TUI_UPDATE_INTERVAL_MS = 2 * 1000;

// --- TUI Setup ---
const screen = blessed.screen({ title: 'DEFQON.1 Stream Recorder by revunix' });
const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });

// Title box removed as per user request.

const recordingsTable = grid.set(0, 0, 8, 6, contrib.markdown, {
  label: 'Live Recordings',
  border: { type: 'line' }
});

const timetableTable = grid.set(0, 6, 8, 6, contrib.markdown, {
  label: 'Timetable',
  border: { type: 'line' }
});

const logOutput = grid.set(8, 0, 3, 12, contrib.log, {
  label: 'Logs'
});

const statusBox = grid.set(11, 0, 1, 12, blessed.box, {
  label: 'Status',
  content: ' Initializing...',
  border: { type: 'line' }
});

// --- Console Redirection ---
console.log = (d) => logOutput.log(d);
console.error = (d) => logOutput.log(`{red-fg}${d}{/red-fg}`);
console.warn = (d) => logOutput.log(`{yellow-fg}${d}{/yellow-fg}`);

// --- Global State ---
const runningProcesses = new Map();
let intervals = [];
let isShuttingDown = false;
let fullTimetable = [];

// --- Helper Functions ---
function sanitize(text) {
    if (typeof text !== 'string') return text;
    // Keep basic alphanumeric, spaces, and common punctuation. Remove the rest.
    return text.replace(/[^\x20-\x7E]/g, '');
}

function formatDuration(totalMinutes) {
    if (totalMinutes < 1) return 'Live';
    const days = Math.floor(totalMinutes / 1440); // 60 * 24
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (days === 0 && minutes > 0) parts.push(`${minutes}m`); // Only show minutes if less than a day

    return parts.join(' ');
}

function generateMarkdownTable(headers, data, columnWidths) {
    const usePadding = Array.isArray(columnWidths) && columnWidths.length === headers.length;

    const padCell = (content, index) => {
        const strContent = String(content);
        if (!usePadding) return strContent;
        return strContent.length > columnWidths[index]
            ? strContent.substring(0, columnWidths[index] - 3) + '...'
            : strContent.padEnd(columnWidths[index]);
    };

    const separator = (index) => {
        if (!usePadding) return '---';
        return '-'.repeat(columnWidths[index]);
    };

    const paddedHeaders = headers.map((h, i) => padCell(h, i));
    const headerLine = `| ${paddedHeaders.join(' | ')} |`;

    const separatorLine = `| ${headers.map((_, i) => separator(i)).join(' | ')} |`;

    if (data.length === 0) {
        return `${headerLine}\n${separatorLine}`;
    }

    const body = data.map(row => {
        const paddedRow = row.map((cell, i) => padCell(cell, i));
        return `| ${paddedRow.join(' | ')} |`;
    }).join('\n');

    return `${headerLine}\n${separatorLine}\n${body}`;
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function loadTimetable() {
    try {
        const data = readFileSync('Defqon2025.json', 'utf8');
        const timetableData = JSON.parse(data);
        let allSets = [];

        timetableData.forEach(stage => {
            const sortedSets = stage.sets
                .filter(s => s.length >= 5) // Ensure there's at least a date and time
                .map(s => ({ raw: s, date: new Date(s[0], s[1] - 1, s[2], s[3], s[4]) }))
                .sort((a, b) => a.date - b.date);

            sortedSets.forEach((set, index) => {
                const [year, month, day, hour, minute, ...djParts] = set.raw;
                const start = set.date;
                const dj = djParts.join(' ') || 'TBA';

                let end;
                if (index < sortedSets.length - 1) {
                    end = sortedSets[index + 1].date;
                } else {
                    // Assume a 60-minute set for the last one of the day/stage
                    end = new Date(start.getTime() + 60 * 60000);
                }

                allSets.push({
                    stage: stage.stage,
                    dj: dj,
                    date: start, // for sorting
                    start: start,
                    end: end,
                });
            });
        });

        fullTimetable = allSets.sort((a, b) => a.date - b.date);
        console.log(`Timetable loaded with ${fullTimetable.length} sets.`);
    } catch (error) {
        console.error(`Failed to load or parse timetable: ${error.message}`);
        fullTimetable = [];
    }
}

function getCurrentSetInfo(stageName) {
    const now = new Date();
    const currentSet = fullTimetable.find(set =>
        set.stage === stageName &&
        now >= set.start &&
        now <= set.end
    );

    if (currentSet) {
        return { artist: currentSet.dj, end: currentSet.end };
    }

    return null;
}

async function fetchStreamInfo(channel) {
  try {
    const response = await fetch(`${API_BASE_URL}${channel}`);
    if (!response.ok) {
      console.error(`[${channel}] API Error: ${response.statusText}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`[${channel}] Fetch Error: ${error.message}`);
    return null;
  }
}

function findLiveBroadcast(data) {
    if (!data?.data?.relationships?.current_broadcast?.data || !data.included) return null;
    const broadcastId = data.data.relationships.current_broadcast.data.id;
    const broadcast = data.included.find(item => item.id === broadcastId);
    if (broadcast?.attributes?.live) {
        return {
            stage: data.data.attributes.username,
            streamUrl: broadcast.attributes.progressive_stream_url,
            listenerCount: broadcast.attributes.listener_count || 0
        };
    }
    return null;
}

function recordStream(stage, streamUrl, listenerCount) {
  if (runningProcesses.has(stage)) return;
  const fileName = `${stage}_${new Date().toISOString().replace(/[\/:]/g, '-')}.mp3`;
  const outputPath = path.join(RECORDINGS_DIR, fileName);
  console.log(`[${stage}] Starting recording...`);
  const ytdlp = spawn('yt-dlp', ['--no-part', '-f', 'bestaudio', '--extract-audio', '--audio-format', 'mp3', '--live-from-start', '-o', outputPath, streamUrl], { stdio: 'pipe' });
  runningProcesses.set(stage, { process: ytdlp, path: outputPath, lastSize: 0, lastCheck: Date.now(), fileName, listeners: listenerCount });
  ytdlp.stderr.on('data', d => !isShuttingDown && d.toString().toLowerCase().includes('error') && console.error(`[${stage}] yt-dlp: ${d.toString().trim()}`))
  ytdlp.on('close', code => {
    if (!isShuttingDown) console.log(`[${stage}] Recording finished (code ${code}).`);
    runningProcesses.delete(stage);
  });
  ytdlp.on('error', err => {
      console.error(`[${stage}] Failed to start: ${err.message}`);
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
                console.warn(`[${stage}] Stalled. Restarting...`);
                info.process.kill('SIGKILL');
                runningProcesses.delete(stage);
            }
        } catch (e) {
            if (e.code !== 'ENOENT') console.error(`[${stage}] Stat error: ${e.message}`);
        }
    }
}

async function checkChannels() {
  console.log(`--- Checking channels at ${new Date().toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' })} ---`);
  for (const channel of CHANNELS) {
    const streamData = await fetchStreamInfo(channel);
    const stageName = streamData?.data?.attributes?.username || channel;
    if (streamData) {
        const liveBroadcast = findLiveBroadcast(streamData);
        const stageName = streamData?.data?.attributes?.username || channel;
        if (liveBroadcast) {
            const { stage, streamUrl, listenerCount } = liveBroadcast;
            if (runningProcesses.has(stage)) {
                const existing = runningProcesses.get(stage);
                if(existing) existing.listeners = listenerCount;
            } else {
                recordStream(stage, streamUrl, listenerCount);
            }
        } else if (runningProcesses.has(stageName)) {
            console.log(`[${stageName}] Offline. Stopping recording.`);
            runningProcesses.get(stageName).process.kill();
            runningProcesses.delete(stageName);
        }
    }
  }
}

function getCurrentSetInfo(stageName) {
    const now = new Date();
    const currentSet = fullTimetable.find(set =>
        set.stage === stageName &&
        now >= set.start &&
        now <= set.end
    );

    if (currentSet) {
        return { artist: currentSet.dj, end: currentSet.end };
    }

    return null;
}

async function updateTui() {
    // Update Recordings Table
    const recordingHeaders = ['Stage', 'Artist', 'Size', 'Ends in'];
    const recordingData = [];
    for (const [stage, info] of runningProcesses.entries()) {
        let size = 'N/A';
        try {
            size = formatBytes((await stat(info.path)).size);
        } catch { /* ignore */ }
        
        const currentSet = getCurrentSetInfo(stage);
        const artist = currentSet ? currentSet.artist : 'N/A';
        let endsIn = 'N/A';
        if (currentSet) {
            const now = new Date();
            const diffMs = currentSet.end.getTime() - now.getTime();
            if (diffMs > 0) {
                endsIn = `${Math.round(diffMs / 60000)} min`;
            } else {
                endsIn = 'Ended';
            }
        }
        recordingData.push([stage, artist, size, endsIn].map(sanitize));
    }

    let recColWidths;
    if (recordingsTable.iwidth > 10) { // check for a minimum width
        const totalWidth = recordingsTable.iwidth - (recordingHeaders.length * 3) - 3;
        if (totalWidth > 0) {
            const col1 = Math.floor(totalWidth * 0.20);
            const col2 = Math.floor(totalWidth * 0.40);
            const col3 = Math.floor(totalWidth * 0.20);
            const col4 = totalWidth - col1 - col2 - col3;
            recColWidths = [col1, col2, col3, col4];
        }
    }
    recordingsTable.setMarkdown(generateMarkdownTable(recordingHeaders, recordingData, recColWidths));

    // Update Timetable Table
    const timetableHeaders = ['Stage', 'Time', 'Artist', 'Starts In'];
    const now = new Date();
    let upcomingSets = [];
    const stagesShown = new Set();

    fullTimetable.forEach(set => {
        if (set.date > now && !stagesShown.has(set.stage)) {
            upcomingSets.push(set);
            stagesShown.add(set.stage);
        }
    });

    const timetableTableData = upcomingSets.map(s => {
        const diffMins = Math.round((s.date - now) / 60000);
        return [
            s.stage,
            s.date.toLocaleString([], { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }),
            s.dj,
            formatDuration(diffMins)
        ].map(sanitize);
    });
    let ttColWidths;
    if (timetableTable.iwidth > 10) {
        const totalWidth = timetableTable.iwidth - (timetableHeaders.length * 3) - 3;
        if (totalWidth > 0) {
            const col1 = Math.floor(totalWidth * 0.25);
            const col2 = Math.floor(totalWidth * 0.20);
            const col3 = Math.floor(totalWidth * 0.35);
            const col4 = totalWidth - col1 - col2 - col3;
            ttColWidths = [col1, col2, col3, col4];
        }
    }
    timetableTable.setMarkdown(generateMarkdownTable(timetableHeaders, timetableTableData, ttColWidths));

    // Update Status Box
    let totalListeners = 0;
    for (const info of runningProcesses.values()) {
        totalListeners += info.listeners || 0;
    }
    statusBox.setContent(sanitize(`DEFQON.1 Recorder by revunix | Active: ${runningProcesses.size}/${CHANNELS.length} | Total Listeners: ${totalListeners.toLocaleString('de-DE')}`));

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
        promises.push(new Promise(resolve => info.process.on('close', resolve)));
        info.process.kill('SIGINT');
    }
    Promise.all(promises).then(() => {
        screen.destroy();
        process.exit(0);
    });
}

async function main() {
  screen.key(['escape', 'q', 'C-c'], gracefulShutdown);

  console.log('--- Starting Stream Recorder ---');
  try {
    await mkdir(RECORDINGS_DIR, { recursive: true });
    console.log(`Recordings saved in: ${path.resolve(RECORDINGS_DIR)}`);
    loadTimetable();
    await updateTui();
  } catch (error) {
    console.error(`Init error: ${error.message}`);
    return;
  }

  await checkChannels();
  intervals.push(setInterval(checkChannels, CHECK_INTERVAL_MS));
  intervals.push(setInterval(monitorStalledRecordings, STALLED_CHECK_INTERVAL_MS));
  intervals.push(setInterval(updateTui, TUI_UPDATE_INTERVAL_MS));
  
  screen.render();
}

main();
