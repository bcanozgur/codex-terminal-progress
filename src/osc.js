/**
 * OSC 9;4 progress reporting for terminals.
 *
 * Sends escape sequences to /dev/tty to show progress in the terminal tab.
 * Supports iTerm2, WezTerm, Ghostty, and Windows Terminal via OSC 9;4.
 * Handles tmux passthrough transparently.
 */

import { openSync, writeSync } from 'node:fs';

/**
 * Terminal types that support OSC 9;4 progress reporting.
 * @type {string}
 */
const SUPPORTED_TERMINALS = ['ghostty', 'iterm2', 'wezterm', 'windows-terminal'];

/**
 * Detect which terminal we're running in.
 * @returns {string|undefined} Terminal identifier or undefined if unsupported.
 */
function detectTerminal() {
  const env = process.env;
  if (env['TERM_PROGRAM'] === 'ghostty') return 'ghostty';
  if (env['TERM_PROGRAM'] === 'iTerm.app' || env['LC_TERMINAL'] === 'iTerm2' || env['ITERM_SESSION_ID']) return 'iterm2';
  if (env['TERM_PROGRAM'] === 'WezTerm' || env['WEZTERM_EXECUTABLE']) return 'wezterm';
  if (env['WT_SESSION']) return 'windows-terminal';
  return undefined;
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
export function createOscWriter() {
  // Check disable env var
  const disableEnv = process.env['CODEX_TERMINAL_PROGRESS'];
  if (disableEnv && /^(0|false|no|disable)$/i.test(disableEnv)) {
    return { osc: () => {}, supported: false };
  }

  const terminal = detectTerminal();
  if (!terminal) {
    return { osc: () => {}, supported: false };
  }

  // Open /dev/tty for writing escape sequences
  let fd;
  try {
    fd = openSync('/dev/tty', 'w');
  } catch {
    return { osc: () => {}, supported: false };
  }

  const inTmux = !!process.env['TMUX'];

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
      writeSync(fd, esc);
    } catch {
      // /dev/tty might close unexpectedly; silently ignore
    }
  }

  return { osc, supported: true };
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
