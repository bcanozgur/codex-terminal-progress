/**
 * codex-terminal-progress
 *
 * Shows Codex CLI agent progress in your terminal tab using
 * OSC 9;4 escape sequences (iTerm2, WezTerm, Ghostty, Windows Terminal).
 */

export { handleHookEvent } from './hook-handler.js';
export { writeProgress, createOscWriter } from './osc.js';
export { setupHooks } from './setup.js';
