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
const HOOKS = [
  {
    name: 'SessionStart',
    command: `${COMMAND} session-start`,
    toml: `[[hooks.SessionStart]]
[[hooks.SessionStart.hooks]]
type = "command"
command = "${COMMAND} session-start"`,
  },
  {
    name: 'UserPromptSubmit',
    command: `${COMMAND} user-prompt-submit`,
    toml: `[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = "${COMMAND} user-prompt-submit"`,
  },
  {
    name: 'PreToolUse',
    command: `${COMMAND} tool-use`,
    toml: `[[hooks.PreToolUse]]
matcher = ".*"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "${COMMAND} tool-use"`,
  },
  {
    name: 'PostToolUse',
    command: `${COMMAND} post-tool-use`,
    toml: `[[hooks.PostToolUse]]
matcher = ".*"

[[hooks.PostToolUse.hooks]]
type = "command"
command = "${COMMAND} post-tool-use"`,
  },
  {
    name: 'PermissionRequest',
    command: `${COMMAND} permission-request`,
    toml: `[[hooks.PermissionRequest]]
matcher = ".*"

[[hooks.PermissionRequest.hooks]]
type = "command"
command = "${COMMAND} permission-request"`,
  },
  {
    name: 'Stop',
    command: `${COMMAND} stop`,
    toml: `[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "${COMMAND} stop"`,
  },
];

/**
 * Setup hooks by appending TOML entries to ~/.codex/config.toml.
 * (Prefer config.toml over hooks.json to avoid the "two representations" warning.)
 */
export async function setupHooks() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const existing = existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, 'utf-8') : '';
  const missingHooks = HOOKS.filter((hook) => !existing.includes(hook.command));

  if (missingHooks.length === 0) {
    console.log('✓ Terminal progress hooks already configured in ~/.codex/config.toml');
    return;
  }

  const hookNames = missingHooks.map((hook) => hook.name).join(', ');
  const tomlEntries = `
# Terminal progress hooks (codex-terminal-progress)
${missingHooks.map((hook) => hook.toml).join('\n\n')}
`;

  // Append to config.toml
  writeFileSync(CONFIG_FILE, tomlEntries, { flag: 'a' });
  console.log(`✓ Appended missing terminal progress hooks to ~/.codex/config.toml: ${hookNames}`);
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
