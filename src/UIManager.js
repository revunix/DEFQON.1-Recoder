const blessed = require('blessed');
const EventEmitter = require('events');

class UIManager extends EventEmitter {
  constructor() {
    super();
    
    try {
      console.log('Initializing blessed screen...');
      this.screen = blessed.screen({
        smartCSR: true,
        title: 'DEFQON.1 Recorder by MIXLR.COM',
        fullUnicode: true,
        terminal: 'xterm-256-color',
        debug: true,
        dockBorders: true,
        autoPadding: true
      });
      
      console.log('Screen initialized, setting up components...');
      this.initComponents();
      
      // Tastatur-Handler
      this.screen.key(['q', 'C-c'], () => {
        console.log('Quit key pressed');
        this.emit('quit');
      });
      
      // Fehlerbehandlung für die Anzeige
      this.screen.on('error', (err) => {
        console.error('Screen error:', err);
      });
      
      console.log('UI Manager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize UI Manager:', error);
      throw error; // Weiterleiten des Fehlers
    }
  }

  initComponents() {
    this.streamsList = blessed.list({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '40%',
      height: '100%-6',
      border: 'line',
      label: ' Channels ',
      keys: true,
      vi: true,
      tags: true,
      style: {
        selected: { bg: 'blue' },
        border: { fg: 'cyan' },
        label: { fg: 'white' },
      },
    });

    this.logBox = blessed.log({
      parent: this.screen,
      top: 0,
      right: 0,
      width: '60%',
      height: '100%-6',
      border: 'line',
      label: ' Log ',
      scrollable: true,
      tags: true,
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white' },
      },
    });

    this.statusBar = blessed.box({
      parent: this.screen,
      bottom: 3,
      left: 0,
      width: '100%',
      height: 3,
      border: 'line',
      label: ' Status ',
      tags: true,
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white' },
      },
    });

    this.helpBar = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: 'line',
      label: ' Help ',
      content: ' {bold}q{/bold}: Quit | {bold}↑/↓{/bold}: Navigate ',
      tags: true,
      style: {
        border: { fg: 'yellow' },
        label: { fg: 'white' },
      },
    });

    this.streamsList.focus();
  }

  log(message) {
    this.logBox.log(`{grey-fg}[${new Date().toLocaleTimeString()}]{/grey-fg} ${message}`);
    this.render();
  }

  logError(message) {
    this.logBox.log(`{red-fg}[${new Date().toLocaleTimeString()}] [ERROR] ${message}{/red-fg}`);
    this.render();
  }

  updateStreamsList(streams, streamStates) {
    const items = streams.map(stream => {
      const state = streamStates[stream.channelId] || { status: 'offline', name: stream.channelId };
      let statusIcon;
      switch (state.status) {
        case 'recording':
          statusIcon = '{green-fg}▶{/green-fg}';
          break;
        case 'live':
          statusIcon = '{cyan-fg}○{/cyan-fg}';
          break;
        case 'error':
          statusIcon = '{red-fg}✖{/red-fg}';
          break;
        case 'offline':
        default:
          statusIcon = '{grey-fg}■{/grey-fg}';
          break;
      }
      const listenerCount = state.listenerCount > 0 ? ` {yellow-fg}👥${state.listenerCount}{/yellow-fg}` : '';
      return `${statusIcon} ${state.name}${listenerCount}`;
    });

    const selected = this.streamsList.selected;
    this.streamsList.setItems(items);
    if (selected < items.length) {
      this.streamsList.select(selected);
    }
    this.render();
  }

  updateStatus(streams, streamStates) {
    const recordingStreams = Object.values(streamStates).filter(s => s.status === 'recording').length;
    const totalStreams = streams.length;
    
    // Berechne die Gesamtzahl der Zuhörer
    const totalListeners = Object.values(streamStates).reduce(
      (sum, stream) => sum + (stream.listenerCount || 0), 0
    );
    
    let statusText = ` {bold}DEFQON.1 Recorder | Active: ${recordingStreams}/${totalStreams} | Total Listeners: ${totalListeners}{/bold}`;

    Object.values(streamStates).forEach((state) => {
      if (state.status === 'recording' && state.startTime) {
        const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        const listeners = state.listenerCount > 0 ? ` 👥${state.listenerCount}` : '';
        statusText += `\n  {green-fg}▶ ${state.name}:{/green-fg} {white-fg}${minutes}:${seconds}{/white-fg}{yellow-fg}${listeners}{/yellow-fg}`;
      }
    });
    this.statusBar.setContent(statusText);
    this.render();
  }

  render() {
    this.screen.render();
  }

  destroy() {
    this.screen.destroy();
  }
}

module.exports = UIManager;
