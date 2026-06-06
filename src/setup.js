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
const NOTIFY_COMMAND = ['codex-terminal-progress', 'notify', 'turn-ended'];
const NOTIFY_CHAIN_PREFIX = ['codex-terminal-progress', 'notify-chain', 'turn-ended'];
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
    name: 'PermissionRequest',
    command: `${COMMAND} permission-request`,
    toml: `[[hooks.PermissionRequest]]
matcher = ".*"

[[hooks.PermissionRequest.hooks]]
type = "command"
command = "${COMMAND} permission-request"`,
  },
  {
    name: 'Notification',
    command: `${COMMAND} notification`,
    toml: `[[hooks.Notification]]
[[hooks.Notification.hooks]]
type = "command"
command = "${COMMAND} notification"`,
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

function parseTomlStringArray(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('[') || !text.endsWith(']')) return undefined;

  const result = [];
  let current = '';
  let inString = false;
  let escaped = false;

  for (let i = 1; i < text.length - 1; i += 1) {
    const char = text[i];

    if (!inString) {
      if (char === '"') {
        inString = true;
        current = '';
      } else if (!/[\s,]/.test(char)) {
        return undefined;
      }
      continue;
    }

    if (escaped) {
      if (char === '"' || char === '\\') current += char;
      else if (char === 'n') current += '\n';
      else if (char === 't') current += '\t';
      else current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      result.push(current);
      inString = false;
      continue;
    }

    current += char;
  }

  return inString || escaped ? undefined : result;
}

function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function formatTomlStringArray(values) {
  return `[${values.map(tomlString).join(', ')}]`;
}

function isTerminalProgressNotify(args) {
  if (!Array.isArray(args)) return false;
  if (args.length >= NOTIFY_COMMAND.length && NOTIFY_COMMAND.every((value, index) => args[index] === value)) return true;
  return args.length >= NOTIFY_CHAIN_PREFIX.length && NOTIFY_CHAIN_PREFIX.every((value, index) => args[index] === value);
}

export function updateNotifyConfig(existing) {
  const lines = String(existing || '').split('\n');
  const firstTableIndex = lines.findIndex((line) => /^\s*\[/.test(line));
  const rootEnd = firstTableIndex === -1 ? lines.length : firstTableIndex;
  const notifyIndex = lines.findIndex((line, index) => index < rootEnd && /^\s*notify\s*=/.test(line));

  if (notifyIndex === -1) {
    const insertAt = rootEnd;
    const nextLines = [...lines];
    const notifyLine = `notify = ${formatTomlStringArray(NOTIFY_COMMAND)}`;
    nextLines.splice(insertAt, 0, notifyLine);
    return { config: nextLines.join('\n'), changed: true, action: 'added' };
  }

  const match = lines[notifyIndex].match(/^(\s*notify\s*=\s*)(.+?)\s*$/);
  const currentArgs = match ? parseTomlStringArray(match[2]) : undefined;
  if (!currentArgs || isTerminalProgressNotify(currentArgs)) {
    return { config: existing, changed: false, action: 'unchanged' };
  }

  const nextArgs = [...NOTIFY_CHAIN_PREFIX, ...currentArgs];
  const nextLines = [...lines];
  nextLines[notifyIndex] = `${match[1]}${formatTomlStringArray(nextArgs)}`;
  return { config: nextLines.join('\n'), changed: true, action: 'chained' };
}

/**
 * Setup hooks by appending TOML entries to ~/.codex/config.toml.
 * (Prefer config.toml over hooks.json to avoid the "two representations" warning.)
 */
export async function setupHooks() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const existing = existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, 'utf-8') : '';
  const notifyUpdate = updateNotifyConfig(existing);
  const configWithNotify = notifyUpdate.config;
  const missingHooks = HOOKS.filter((hook) => !configWithNotify.includes(hook.command));

  if (missingHooks.length === 0 && !notifyUpdate.changed) {
    console.log('✓ Terminal progress hooks already configured in ~/.codex/config.toml');
    return;
  }

  const hookNames = missingHooks.map((hook) => hook.name).join(', ');
  const tomlEntries = `
# Terminal progress hooks (codex-terminal-progress)
${missingHooks.map((hook) => hook.toml).join('\n\n')}
`;

  const nextConfig = `${configWithNotify}${missingHooks.length === 0 ? '' : tomlEntries}`;
  writeFileSync(CONFIG_FILE, nextConfig);

  if (missingHooks.length > 0) {
    console.log(`✓ Appended missing terminal progress hooks to ~/.codex/config.toml: ${hookNames}`);
  }
  if (notifyUpdate.changed) {
    const verb = notifyUpdate.action === 'chained' ? 'Chained' : 'Added';
    console.log(`✓ ${verb} terminal progress turn-ended notify in ~/.codex/config.toml`);
  }
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
  console.log('  • Orange at 100%         → Agent is waiting for your input');
  console.log('  • Red (error)            → Agent encountered an error');
  console.log('  • Cleared                → Session start/manual idle reset');
  console.log('');
  console.log('To disable: export CODEX_TERMINAL_PROGRESS=0');
}
