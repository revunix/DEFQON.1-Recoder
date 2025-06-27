# DEFQON.1 Stream Recorder

A powerful terminal-based application for recording multiple Mixlr streams simultaneously with a beautiful TUI (Terminal User Interface). Perfect for recording live DJ sets from DEFQON.1 and other Mixlr streams.

![Screenshot](screenshot_new.png)

<a href='https://ko-fi.com/revunix' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://cdn.ko-fi.com/cdn/kofi1.png?v=3' border='0' alt='Buy Me a Coffee' /></a>

## ✨ Features

- 🎵 Record multiple Mixlr streams simultaneously
- 🖥️ Intuitive Terminal User Interface (TUI)
- 📊 Real-time listener count display
- ⏱️ Recording duration tracking
- 📅 Built-in timetable with DJ set times
- 🔍 Automatic current DJ detection
- 📈 Real-time recording statistics
- 🛡️ Robust error handling and recovery
- 🎨 Clean, responsive interface
- 🚀 Optimized for performance and reliability

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.0.0 or higher)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (for stream downloading)
- [FFmpeg](https://ffmpeg.org/) (for audio conversion)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/revunix/DEFQON.1-Recoder.git
   cd DEFQON.1-Recoder
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Start the application:
   ```bash
   bun start
   ```

## 🎛️ Controls

- `q` or `Ctrl+C` - Quit application
- `r` - Refresh stream list
- `↑/↓` - Navigate between streams (if interactive mode is enabled)
- `Space` - Toggle recording (if interactive mode is enabled)

## 📂 File Naming

Recordings are saved in the following format:
```
[StageName]_[YYYY-MM-DDThh-mm-ss].mp3
```

## 🛠️ Configuration

### Automatic Configuration

The application automatically configures itself with sensible defaults. No configuration is required to get started.

### Environment Variables

- `RECORDINGS_DIR` - Directory to save recordings (default: `./recordings`)
- `CHECK_INTERVAL_MS` - Stream check interval in milliseconds (default: `60000`)
- `TUI_UPDATE_INTERVAL_MS` - UI refresh rate in milliseconds (default: `2000`)

## 📝 Changelog

### [Released] - 2025-06-27

#### Added
- **Timetable Integration**
  - Added support for displaying the event schedule
  - Shows current DJ and remaining set time for each stage
  - Displays upcoming sets with countdown timers

- **Enhanced UI/UX**
  - Redesigned TUI with better layout organization
  - Added status bar showing active streams and total listeners
  - Improved table rendering with dynamic column widths
  - Added proper console output redirection to log panel

- **Error Handling**
  - Added input sanitization to prevent crashes from special characters
  - Improved error handling for API requests and file operations
  - Added graceful shutdown handling

#### Changed
- **Code Structure**
  - Refactored codebase for better maintainability
  - Improved module organization and separation of concerns
  - Enhanced code documentation

- **Performance**
  - Optimized stream monitoring and recording processes
  - Reduced memory usage through better resource management
  - Improved handling of stalled recordings

- **Dependencies**
  - Updated to use modern Node.js features
  - Removed unnecessary dependencies

#### Fixed
- **Stability**
  - Fixed crashes related to terminal color handling
  - Resolved issues with stream detection and recording
  - Fixed memory leaks in long-running sessions

- **Compatibility**
  - Improved cross-terminal compatibility
  - Better handling of different terminal window sizes
  - Fixed issues with special characters in stream metadata

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Made with ❤️ for the DEFQON.1 community
- Powered by [Mixlr](https://mixlr.com/)
- Built with [Bun](https://bun.sh/) and [blessed](https://github.com/chjj/blessed)

---

*This project is not affiliated with or endorsed by Q-dance or Mixlr. Use at your own risk and respect all copyright laws and terms of service.*
