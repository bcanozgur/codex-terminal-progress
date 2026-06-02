#!/usr/bin/env node

/**
 * codex-terminal-progress CLI
 *
 * Commands:
 *   hook <event>    - Called by Codex hooks, reads stdin for event JSON
 *   write <state>   - Write a progress state directly (busy|idle|error|paused)
 *   setup           - Auto-configure hooks in ~/.codex/hooks.json
 *   status          - Check if terminal progress is supported
 *   monitor-parent  - Internal watchdog that clears progress when Codex exits
 */

import { openSync, writeSync } from 'node:fs';
import { handleHookEvent, monitorParentProcess } from '../src/hook-handler.js';
import { writeProgress, createOscWriter } from '../src/osc.js';
import { setupHooks } from '../src/setup.js';

const [, , command, ...args] = process.argv;

/**
 * Cleanup handler for SIGINT/SIGTERM — tries to clear the terminal progress bar
 * before the process exits. Uses writeSync so it works even during abrupt shutdown.
 */
function registerCleanup() {
  // Only register once
  if (process.listeners('SIGINT').length > 0) return;

  const cleanup = () => {
    try {
      const fd = openSync('/dev/tty', 'w');
      writeSync(fd, '\x1b]9;4;0\x07');
    } catch {
      // /dev/tty unavailable — nothing to clean up
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// If this is a hook command that sets progress, register cleanup
if (command === 'hook' && ['pre-tool-use', 'tool-use', 'user-prompt-submit', 'post-tool-use', 'permission-request'].includes(args[0])) {
  registerCleanup();
}

async function main() {
  switch (command) {
    case 'hook': {
      const eventName = args[0];
      if (!eventName) {
        console.error('Usage: codex-terminal-progress hook <event-name>');
        process.exit(1);
      }
      const result = handleHookEvent(eventName);
      process.exit(result.exitCode);
      break;
    }

    case 'write': {
      const state = args[0];
      if (!state || !['busy', 'idle', 'error', 'paused'].includes(state)) {
        console.error('Usage: codex-terminal-progress write <busy|idle|error|paused>');
        process.exit(1);
      }
      const sent = writeProgress(state);
      process.exit(sent ? 0 : 1);
      break;
    }

    case 'setup':
      await setupHooks();
      break;

    case 'monitor-parent': {
      const parentPid = Number.parseInt(args[0], 10);
      const result = await monitorParentProcess(parentPid);
      process.exit(result.exitCode);
      break;
    }

    case 'status': {
      // Separate detection from /dev/tty access for better diagnostics
      const env = process.env;
      const terminal = env['TERM_PROGRAM'] === 'ghostty' ? 'ghostty' :
        env['TERM_PROGRAM'] === 'iTerm.app' || env['LC_TERMINAL'] === 'iTerm2' || env['ITERM_SESSION_ID'] ? 'iterm2' :
        env['TERM_PROGRAM'] === 'WezTerm' || env['WEZTERM_EXECUTABLE'] ? 'wezterm' :
        env['WT_SESSION'] ? 'windows-terminal' : undefined;

      const writer = createOscWriter();
      if (writer.supported) {
        console.log('✓ Terminal progress is supported');
        // Flash all states as a test
        writer.osc('3');
        setTimeout(() => writer.osc('2'), 400);
        setTimeout(() => writer.osc('4;50'), 800);
        setTimeout(() => writer.osc('0'), 1200);
      } else {
        console.log('Terminal Detection Summary:');
        console.log('');
        console.log(`  TERM_PROGRAM:       ${env['TERM_PROGRAM'] || '(not set)'}`);
        console.log(`  LC_TERMINAL:        ${env['LC_TERMINAL'] || '(not set)'}`);
        console.log(`  ITERM_SESSION_ID:   ${env['ITERM_SESSION_ID'] || '(not set)'}`);
        console.log(`  WEZTERM_EXECUTABLE: ${env['WEZTERM_EXECUTABLE'] || '(not set)'}`);
        console.log(`  WT_SESSION:         ${env['WT_SESSION'] || '(not set)'}`);
        console.log(`  TMUX:               ${env['TMUX'] || '(not set)'}`);
        console.log('');

        if (terminal) {
          console.log(`✓ Detected terminal: ${terminal}`);
          console.log('✗ Cannot access /dev/tty (expected when running in non-interactive shell)');
          console.log('');
          console.log('This is normal when testing here, but when Codex hooks');
          console.log('run during actual sessions, /dev/tty will be accessible.');
        } else {
          console.log('✗ Unsupported terminal');
          console.log('');
          console.log('Supported terminals: iTerm2, WezTerm, Ghostty, Windows Terminal');
        }
        process.exit(1);
      }
      break;
    }

    default:
      console.log(`
codex-terminal-progress — Codex CLI terminal progress indicator

Usage:
  codex-terminal-progress hook <event>     Handle a Codex hook event
  codex-terminal-progress write <state>    Write a progress state directly
  codex-terminal-progress setup            Add hooks to ~/.codex/config.toml
  codex-terminal-progress status           Check if terminal is supported

States: busy, idle, error, paused

Setup: codex-terminal-progress setup
`);
      break;
  }
}

main().catch((err) => {
  console.error('codex-terminal-progress error:', err.message);
  process.exit(1);
});
