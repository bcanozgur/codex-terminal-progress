/**
 * Codex hook event handler for terminal progress.
 *
 * Invoked by Codex hooks. Reads the event JSON from stdin,
 * determines the progress state, and writes OSC 9;4 sequences
 * to /dev/tty to show progress in the terminal tab.
 *
 * State tracking uses ~/.codex/terminal-progress-state.json to
 * prevent rapid OSC flapping between tool transitions.
 */

import { writeProgress } from './osc.js';
import { readFileSync, writeFileSync, readSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const STATE_DIR = join(homedir(), '.codex');
const STATE_FILE = join(STATE_DIR, 'terminal-progress-state.json');
const DEBOUNCE_MS = 500;

function readState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch { /* reset */ }
  return { currentState: 'idle', lastChange: 0, pid: 0 };
}

function writeState(state) {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ currentState: state, lastChange: Date.now(), pid: process.ppid }));
  } catch { /* best-effort */ }
}

/**
 * Update the terminal progress bar.
 *
 * @param {string} newState - The new progress state ('busy'|'idle'|'error'|'paused').
 * @param {boolean} force - If true, bypass state-diff check AND debounce timer.
 * @returns {boolean} Whether the progress was written.
 */
function updateProgress(newState, force = false) {
  const state = readState();
  const now = Date.now();

  // Stale session detection: if stored PID is from a dead parent, clear progress first.
  if (state.pid && state.currentState !== 'idle') {
    try {
      // Sending signal 0 checks if process exists without actually signaling it
      process.kill(state.pid, 0);
    } catch {
      // Parent process is dead — clear stale progress from the terminated session
      writeProgress('idle');
      writeState('idle');
      // Force the update: `state.currentState` is still the stale 'busy' from readState()
      // so without force, the state-diff check below would block the new state from writing
      force = true;
    }
  }

  if (!force && newState === state.currentState) return false;
  if (!force && now - state.lastChange < DEBOUNCE_MS) return false;
  const sent = writeProgress(newState);
  if (sent) writeState(newState);
  return sent;
}

/**
 * Read stdin synchronously (buffered, up to 64KB).
 */
function readStdin() {
  try {
    const buf = Buffer.alloc(65536);
    const bytes = readSync(process.stdin.fd, buf, 0, 65536, 0);
    if (bytes && bytes > 0) return buf.toString('utf-8', 0, bytes).trim();
  } catch { /* no stdin */ }
  return '';
}

/**
 * Handle a Codex hook event.
 *
 * @param {string} eventName - e.g. "user-prompt-submit", "stop", "post-tool-use"
 * @returns {{ exitCode: number }}
 */
export function handleHookEvent(eventName) {
  const stdin = readStdin();
  let inputData = {};
  if (stdin) {
    try { inputData = JSON.parse(stdin); } catch { /* ignore */ }
  }

  let progressState = null;
  let force = false;

  switch (eventName) {
    case 'user-prompt-submit':
    case 'tool-use':
      progressState = 'busy';
      break;

    case 'post-tool-use': {
      // Check for tool errors
      const resp = inputData?.tool_response;
      if (resp && typeof resp === 'object') {
        const exitCode = resp.exit_code ?? resp.exitCode;
        if (exitCode !== undefined && exitCode !== 0 && exitCode !== null) {
          progressState = 'error';
        }
      }
      break;
    }

    case 'session-start':
      // Force-clear any stale progress left from a previously killed Codex session
      writeProgress('idle');
      progressState = 'idle';
      force = true;
      break;

    case 'stop':
    case 'idle':
      progressState = 'idle';
      force = true;
      break;

    case 'permission-request':
      progressState = 'paused';
      break;
  }

  if (progressState) updateProgress(progressState, force);

  return { exitCode: 0 };
}
