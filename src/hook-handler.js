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
import { spawn, spawnSync } from 'node:child_process';

const STATE_DIR = join(homedir(), '.codex');
const STATE_FILE = join(STATE_DIR, 'terminal-progress-state.json');
const DEBOUNCE_MS = 500;
const REFRESH_MS = 2_000;
const MONITOR_INTERVAL_MS = 250;
const MONITORED_STATES = new Set(['busy', 'error', 'paused', 'waiting']);

function readState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch { /* reset */ }
  return { currentState: 'idle', lastChange: 0, pid: 0, monitorPid: 0 };
}

function writeState(state, parentPid = process.ppid, monitorPid = 0) {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({
      currentState: state,
      lastChange: Date.now(),
      pid: parentPid,
      monitorPid,
    }));
  } catch { /* best-effort */ }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processInfoForPid(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return undefined;

  try {
    const result = spawnSync('ps', ['-o', 'ppid=', '-o', 'args=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 500,
    });
    if (result.status !== 0) return undefined;

    const match = result.stdout.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) return undefined;
    return {
      ppid: Number.parseInt(match[1], 10),
      args: match[2],
    };
  } catch {
    return undefined;
  }
}

function isCodexCliProcess(args) {
  const command = String(args || '');
  if (!command || command.includes('codex-terminal-progress')) return false;
  return /(^|[/\s])codex(\.js)?($|\s)/i.test(command) || command.includes('@openai/codex');
}

export function resolveSessionOwnerPid(startPid, processInfo = processInfoForPid, maxDepth = 8) {
  let currentPid = startPid;
  const seen = new Set();

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (!Number.isInteger(currentPid) || currentPid <= 1 || seen.has(currentPid)) return undefined;
    seen.add(currentPid);

    const info = processInfo(currentPid);
    if (!info) return undefined;
    if (isCodexCliProcess(info.args)) return currentPid;
    currentPid = info.ppid;
  }

  return undefined;
}

export function shouldSkipProgressUpdate(state, newState, now, force = false) {
  if (!force && newState === state.currentState) {
    if (MONITORED_STATES.has(newState) && now - state.lastChange >= REFRESH_MS) return false;
    return true;
  }

  // Do not let the startup/stop idle write hide the first visible working state.
  // The debounce is only meant to dampen rapid visible-state flapping.
  const isStartingWork = state.currentState === 'idle' && newState !== 'idle';
  if (!force && !isStartingWork && now - state.lastChange < DEBOUNCE_MS) return true;

  return false;
}

export function shouldStartParentMonitor(state, newState, parentPid, processAlive = isProcessAlive) {
  if (!MONITORED_STATES.has(newState)) return false;
  if (!Number.isInteger(parentPid) || parentPid <= 1) return false;
  if (state.pid !== parentPid) return true;
  if (!state.monitorPid) return true;
  return !processAlive(state.monitorPid);
}

export function shouldPersistProgressState(newState, sent) {
  return newState === 'idle' || sent;
}

function startParentMonitor(state, newState, parentPid) {
  if (!shouldStartParentMonitor(state, newState, parentPid)) return state.monitorPid || 0;

  try {
    const child = spawn(process.execPath, [process.argv[1], 'monitor-parent', String(parentPid)], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    return child.pid || 0;
  } catch {
    return state.monitorPid || 0;
  }
}

/**
 * Update the terminal progress bar.
 *
 * @param {string} newState - The new progress state ('busy'|'idle'|'error'|'paused'|'waiting').
 * @param {boolean} force - If true, bypass state-diff check AND debounce timer.
 * @returns {boolean} Whether the progress was written.
 */
function updateProgress(newState, force = false) {
  const state = readState();
  const now = Date.now();
  const sessionOwnerPid = resolveSessionOwnerPid(process.ppid) || 0;

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

  if (shouldSkipProgressUpdate(state, newState, now, force)) return false;
  const sent = writeProgress(newState);
  if (shouldPersistProgressState(newState, sent) && newState === 'idle') {
    writeState(newState, sessionOwnerPid, 0);
    return sent;
  }

  if (shouldPersistProgressState(newState, sent)) {
    const nextState = {
      ...state,
      currentState: newState,
      pid: sessionOwnerPid,
      monitorPid: state.pid === sessionOwnerPid ? state.monitorPid : 0,
    };
    writeState(newState, sessionOwnerPid, nextState.monitorPid);
    const monitorPid = startParentMonitor(nextState, newState, sessionOwnerPid);
    writeState(newState, sessionOwnerPid, monitorPid);
  }
  return sent;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function monitorParentProcess(parentPid, intervalMs = MONITOR_INTERVAL_MS) {
  if (!Number.isInteger(parentPid) || parentPid <= 1) return { exitCode: 1 };

  while (true) {
    const state = readState();
    if (state.pid !== parentPid || state.currentState === 'idle') return { exitCode: 0 };

    if (!isProcessAlive(parentPid)) {
      writeProgress('idle');
      writeState('idle', parentPid, 0);
      return { exitCode: 0 };
    }

    await sleep(intervalMs);
  }
}

export function progressStateForHookEvent(eventName, inputData = {}) {
  const event = String(eventName || '').toLowerCase();

  switch (event) {
    case 'user-prompt-submit':
    case 'pre-tool-use':
    case 'tool-use':
      return { progressState: 'busy', force: false };

    case 'post-tool-use': {
      const resp = inputData?.tool_response;
      if (resp && typeof resp === 'object') {
        const exitCode = resp.exit_code ?? resp.exitCode;
        if (exitCode !== undefined && exitCode !== 0 && exitCode !== null) {
          return { progressState: 'error', force: false };
        }
      }
      // Older installs may still have PostToolUse hooks configured. A
      // successful tool completion does not mean Codex has stopped working;
      // keep the visible busy state until Stop clears it.
      return { progressState: 'busy', force: false };
    }

    case 'session-start':
      return { progressState: 'idle', force: true, clearStale: true };

    case 'idle':
    case 'stop':
    case 'turn-ended':
    case 'turn-end':
    case 'task-complete':
    case 'task_complete':
    case 'response-complete':
      return { progressState: 'idle', force: true };

    case 'permission-request':
      return { progressState: 'paused', force: false };

    case 'notification':
    case 'notify':
      return progressStateForNotification(inputData);

    default:
      return { progressState: null, force: false };
  }
}

function hookPayloadText(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => hookPayloadText(item, depth + 1)).join('\n');
  if (typeof value === 'object') return Object.values(value).map((item) => hookPayloadText(item, depth + 1)).join('\n');
  return '';
}

export function progressStateForNotification(inputData = {}) {
  const text = hookPayloadText(inputData).toLowerCase();

  if (/(usage limit|rate limit|upgrade to pro|purchase more credits|try again at|you'?ve hit your usage limit)/.test(text)) {
    return { progressState: 'idle', force: true };
  }

  if (/(waiting for (your )?(input|approval)|permission|approval required)/.test(text)) {
    return { progressState: 'paused', force: false };
  }

  // A terminal notification means Codex has surfaced something to the user, not
  // that the agent is still computing. Clear any stale green busy indicator.
  return { progressState: 'idle', force: true };
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

  const { progressState, force, clearStale } = progressStateForHookEvent(eventName, inputData);

  if (clearStale) {
    // Force-clear any stale progress left from a previously killed Codex session.
    writeProgress('idle');
  }

  if (progressState) updateProgress(progressState, force);

  return { exitCode: 0 };
}
