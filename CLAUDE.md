# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## AI Guidance

* Ignore GEMINI.md and GEMINI-*.md files
* To save main context space, for code searches, inspections, troubleshooting or analysis, use code-searcher subagent where appropriate - giving the subagent full context background for the task(s) you assign it.
* After receiving tool results, carefully reflect on their quality and determine optimal next steps before proceeding. Use your thinking to plan and iterate based on this new information, and then take the best next action.
* For maximum efficiency, whenever you need to perform multiple independent operations, invoke all relevant tools simultaneously rather than sequentially.
* Before you finish, please verify your solution
* Do what has been asked; nothing more, nothing less.
* NEVER create files unless they're absolutely necessary for achieving your goal.
* ALWAYS prefer editing an existing file to creating a new one.
* NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
* When you update or modify core context files, also update markdown documentation and memory bank
* When asked to commit changes, exclude CLAUDE.md and CLAUDE-*.md referenced memory bank system files from any commits. Never delete these files.

## Memory Bank System

This project uses a structured memory bank system with specialized context files. Always check these files for relevant information before starting work:

### Core Context Files

* **CLAUDE-activeContext.md** - Current session state, goals, and progress (if exists)
* **CLAUDE-patterns.md** - Established code patterns and conventions (if exists)
* **CLAUDE-decisions.md** - Architecture decisions and rationale (if exists)
* **CLAUDE-troubleshooting.md** - Common issues and proven solutions (if exists)
* **CLAUDE-config-variables.md** - Configuration variables reference (if exists)
* **CLAUDE-temp.md** - Temporary scratch pad (only read when referenced)

**Important:** Always reference the active context file first to understand what's currently being worked on and maintain session continuity.

### Memory Bank System Backups

When asked to backup Memory Bank System files, you will copy the core context files above and @.claude settings directory to directory @/path/to/backup-directory. If files already exist in the backup directory, you will overwrite them.

## Project Overview

This is a Roon Volume Control extension for controlling Denon/Marantz AV receivers over the network. It integrates with Roon's API to provide volume, mute, source selection, and power control capabilities.

### Key Architecture

**Main Components:**
- **app.js** - Main application entry point that orchestrates Roon API services and Denon client
- **src/zone-functions.js** - Modular zone control functions (Main Zone and Zone 2)
- **Roon API Services:**
  - RoonApiSettings - Configuration UI in Roon
  - RoonApiStatus - Connection status reporting
  - RoonApiVolumeControl - Volume and mute control (Main Zone only)
  - RoonApiSourceControl - Input selection and standby control
- **Denon Client** - Network communication with receiver via denon-client library

**Event-Driven Architecture:**
The extension listens to receiver events (powerChanged, inputChanged, muteChanged, masterVolumeChanged, zone2Changed) and updates Roon's state accordingly. Socket connection includes keep-alive mechanism and automatic reconnection on disconnect.

**Multi-Zone Support:**
- **Main Zone** - Full control (volume, mute, input, power)
- **Zone 2** - Power control only (no volume control)
- Configurable "Power Off Behavior" to turn off both zones or selected zone only

**State Management:**
- `denon.volume_state` - Tracks volume level, mute status, min/max values
- `denon.source_state` - Tracks power status, input selection, and source control state
- Settings persisted via `roon.save_config()`

### Development Commands

**Installation:**
```bash
npm install
```

**Run the extension:**
```bash
node .
```
The extension will appear in Roon under Settings → Setup → Extensions and can be added as Volume Control to an output zone.

**Testing:**
```bash
npm test                  # Run all tests
npm run test:watch        # Run tests in watch mode
npm run test:coverage     # Run tests with coverage report
```

Test files are located in `test/` directory using Jest framework.

**Debugging:**
Set DEBUG environment variable to see detailed logs:
```bash
DEBUG=roon-extension-denon* node .
```

### Important Notes

- Receiver only accepts one Telnet connection at a time - running this extension may block other Telnet-based applications
- Volume values are stored as dB offset from receiver's internal scale (receiver value - 80)
- Zone 2 does not support volume control via the network API, only power control
