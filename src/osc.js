/**
 * OSC 9;4 progress reporting for terminals.
 *
 * Sends escape sequences to /dev/tty to show progress in the terminal tab.
 * Supports iTerm2, WezTerm, Ghostty, and Windows Terminal via OSC 9;4.
 * Handles tmux passthrough transparently.
 */

import { openSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/**
 * Terminal types that support OSC 9;4 progress reporting.
 * @type {string}
 */
const SUPPORTED_TERMINALS = ['ghostty', 'iterm2', 'wezterm', 'windows-terminal'];
export const MIN_ITERM_PROGRESS_VERSION = '3.6.6';

/**
 * Detect which terminal we're running in.
 * @returns {string|undefined} Terminal identifier or undefined if unsupported.
 */
export function detectTerminal(env = process.env) {
  if (env['TERM_PROGRAM'] === 'ghostty') return 'ghostty';
  if (env['TERM_PROGRAM'] === 'iTerm.app' || env['LC_TERMINAL'] === 'iTerm2' || env['ITERM_SESSION_ID']) return 'iterm2';
  if (env['TERM_PROGRAM'] === 'WezTerm' || env['WEZTERM_EXECUTABLE']) return 'wezterm';
  if (env['WT_SESSION']) return 'windows-terminal';
  return undefined;
}

function parseVersion(version) {
  return String(version || '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isInteger(part));
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let i = 0; i < length; i += 1) {
    const leftPart = leftParts[i] || 0;
    const rightPart = rightParts[i] || 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

function terminalSupportIssue(terminal, env) {
  if (terminal !== 'iterm2') return undefined;

  const version = env['TERM_PROGRAM_VERSION'] || env['LC_TERMINAL_VERSION'];
  if (!version) {
    return {
      code: 'iterm-version-unknown',
      message: `iTerm2 version is unknown; OSC 9;4 progress requires iTerm2 ${MIN_ITERM_PROGRESS_VERSION} or newer.`,
    };
  }

  if (compareVersions(version, MIN_ITERM_PROGRESS_VERSION) < 0) {
    return {
      code: 'iterm-version-too-old',
      version,
      minimumVersion: MIN_ITERM_PROGRESS_VERSION,
      message: `iTerm2 ${version} does not support OSC 9;4 progress bars; upgrade to iTerm2 ${MIN_ITERM_PROGRESS_VERSION} or newer.`,
    };
  }

  return undefined;
}

export function normalizeTtyPath(value) {
  const tty = typeof value === 'string' ? value.trim() : '';
  if (!tty || tty === '?' || tty === '??') return undefined;
  if (tty.startsWith('/dev/')) return tty;
  if (/^tty/.test(tty)) return `/dev/${tty}`;
  return undefined;
}

function processInfoForPid(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return undefined;

  try {
    const result = spawnSync('ps', ['-o', 'ppid=', '-o', 'tty=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 500,
    });
    if (result.status !== 0) return undefined;
    const match = result.stdout.trim().match(/^(\d+)\s+(\S+)$/);
    if (!match) return undefined;
    return {
      ppid: Number.parseInt(match[1], 10),
      ttyPath: normalizeTtyPath(match[2]),
    };
  } catch {
    return undefined;
  }
}

function ttyPathForProcessTree(pid, maxDepth = 8) {
  let currentPid = pid;
  const seen = new Set();

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (!Number.isInteger(currentPid) || currentPid <= 1 || seen.has(currentPid)) return undefined;
    seen.add(currentPid);

    const info = processInfoForPid(currentPid);
    if (!info) return undefined;
    if (info.ttyPath) return info.ttyPath;
    currentPid = info.ppid;
  }

  return undefined;
}

export function ttyPathCandidates({
  env = process.env,
  parentPid = process.ppid,
  parentTtyPath = ttyPathForProcessTree,
} = {}) {
  const seen = new Set();
  const paths = [];

  const add = (path) => {
    const normalized = normalizeTtyPath(path);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    paths.push(normalized);
  };

  add('/dev/tty');
  add(env['CODEX_TERMINAL_TTY']);
  add(env['TTY']);
  add(env['SSH_TTY']);
  add(parentTtyPath(parentPid));

  return paths;
}

/**
 * Progress states mapped to OSC 9;4 codes.
 *
 * - `3` = indeterminate (busy)
 * - `0` = cleared (idle)
 * - `2` = error (red)
 * - `4;{n}` = determinate at n% (e.g., `4;50` = paused/halfway)
 *
 * @type {Object<string, string>}
 */
const PROGRESS_CODES = {
  busy: '3',
  idle: '0',
  error: '2',
  paused: '4;50',
};

/**
 * Create an OSC 9;4 writer function for the current terminal.
 *
 * Returns undefined if:
 * - The terminal is unsupported
 * - /dev/tty cannot be opened
 * - The CODEX_TERMINAL_PROGRESS env var disables it
 *
 * @returns {{ osc: (code: string) => void, supported: boolean }} The writer and whether the terminal is supported.
 */
export function createOscWriter({
  env = process.env,
  openFile = openSync,
  writeFile = writeSync,
  parentPid = process.ppid,
  parentTtyPath = ttyPathForProcessTree,
} = {}) {
  // Check disable env var
  const disableEnv = env['CODEX_TERMINAL_PROGRESS'];
  if (disableEnv && /^(0|false|no|disable)$/i.test(disableEnv)) {
    return { osc: () => {}, supported: false };
  }

  const terminal = detectTerminal(env);
  if (!terminal) {
    return { osc: () => {}, supported: false };
  }

  const issue = terminalSupportIssue(terminal, env);
  if (issue) {
    return { osc: () => {}, supported: false, terminal, issue };
  }

  // Hooks may run without a controlling TTY after Codex CLI updates. Try the
  // inherited terminal first, then explicit/env and parent-process TTY fallbacks.
  let fd;
  let ttyPath;
  for (const candidate of ttyPathCandidates({ env, parentPid, parentTtyPath })) {
    try {
      fd = openFile(candidate, 'w');
      ttyPath = candidate;
      break;
    } catch {
      // Try the next candidate.
    }
  }

  if (fd === undefined) {
    return { osc: () => {}, supported: false };
  }

  const inTmux = !!env['TMUX'];

  /**
   * Write an OSC 9;4 escape sequence to the terminal.
   * @param {string} code - The OSC code payload (e.g., "3", "0", "2", "4;50")
   */
  function osc(code) {
    // OSC 9;4 payload
    const payload = `9;4;${code}`;
    // In tmux, wrap with tmux passthrough escape sequence
    const esc = inTmux
      ? `\x1bPtmux;\x1b\x1b]${payload}\x07\x1b\\`
      : `\x1b]${payload}\x07`;
    try {
      writeFile(fd, esc);
    } catch {
      // /dev/tty might close unexpectedly; silently ignore
    }
  }

  return { osc, supported: true, terminal, ttyPath };
}

/**
 * Write a specific progress state to the terminal.
 *
 * @param {'busy'|'idle'|'error'|'paused'} state - The progress state to show.
 * @returns {boolean} Whether the write was successful.
 */
export function writeProgress(state) {
  const writer = createOscWriter();
  if (!writer.supported) return false;
  const code = PROGRESS_CODES[state];
  if (!code) return false;
  writer.osc(code);
  return true;
}
