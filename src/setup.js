/**
 * Auto-setup Codex hooks for terminal progress.
 *
 * Appends hook entries to ~/.codex/config.toml.
 * (Prefer config.toml over hooks.json to avoid the "two representations" warning.)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.codex');
const CONFIG_FILE = join(CONFIG_DIR, 'config.toml');
const COMMAND = 'codex-terminal-progress hook';

/**
 * Setup hooks by appending TOML entries to ~/.codex/config.toml.
 * (Prefer config.toml over hooks.json to avoid the "two representations" warning.)
 */
export async function setupHooks() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Check if already present
  if (existsSync(CONFIG_FILE)) {
    const existing = readFileSync(CONFIG_FILE, 'utf-8');
    if (existing.includes('codex-terminal-progress hook')) {
      console.log('✓ Terminal progress hooks already configured in ~/.codex/config.toml');
      return;
    }
  }

  const tomlEntries = `
# Terminal progress hooks (codex-terminal-progress)
[[hooks.SessionStart]]
[[hooks.SessionStart.hooks]]
type = "command"
command = "${COMMAND} session-start"

[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = "${COMMAND} user-prompt-submit"

[[hooks.PreToolUse]]
matcher = ".*"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "${COMMAND} tool-use"

[[hooks.PostToolUse]]
matcher = ".*"

[[hooks.PostToolUse.hooks]]
type = "command"
command = "${COMMAND} post-tool-use"

[[hooks.PermissionRequest]]
matcher = ".*"

[[hooks.PermissionRequest.hooks]]
type = "command"
command = "${COMMAND} permission-request"

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "${COMMAND} stop"
`;

  // Append to config.toml
  writeFileSync(CONFIG_FILE, tomlEntries, { flag: 'a' });
  console.log('✓ Appended terminal progress hooks to ~/.codex/config.toml');
  console.log('');
  printNextSteps();
}

function printNextSteps() {
  console.log('');
  console.log('➡️ Restart Codex CLI to apply: just close and reopen it, or type /reload');
  console.log('');
  console.log('If new hooks need trust, run /hooks in Codex and press t to trust each one.');
  console.log('');
  console.log('Terminal progress states:');
  console.log('  • Spinner (indeterminate) → Agent is working');
  console.log('  • Paused at 50%          → Agent is waiting for your approval');
  console.log('  • Red (error)            → Agent encountered an error');
  console.log('  • Cleared                → Agent is idle / waiting for your input');
  console.log('');
  console.log('To disable: export CODEX_TERMINAL_PROGRESS=0');
}
