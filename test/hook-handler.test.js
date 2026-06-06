import test from 'node:test';
import assert from 'node:assert/strict';
import {
  progressStateForNotification,
  progressStateForHookEvent,
  resolveSessionOwnerPid,
  shouldPersistProgressState,
  shouldSkipProgressUpdate,
  shouldStartParentMonitor,
} from '../src/hook-handler.js';

test('does not debounce the first visible state after idle', () => {
  const now = 1_000;
  const state = { currentState: 'idle', lastChange: now - 10 };

  assert.equal(shouldSkipProgressUpdate(state, 'busy', now), false);
});

test('still debounces rapid visible-state changes', () => {
  const now = 1_000;
  const state = { currentState: 'busy', lastChange: now - 10 };

  assert.equal(shouldSkipProgressUpdate(state, 'paused', now), true);
});

test('force bypasses state diff and debounce', () => {
  const now = 1_000;
  const state = { currentState: 'idle', lastChange: now };

  assert.equal(shouldSkipProgressUpdate(state, 'idle', now, true), false);
});

test('refreshes long-lived visible states instead of skipping forever', () => {
  const now = 5_000;
  const state = { currentState: 'busy', lastChange: now - 3_000 };

  assert.equal(shouldSkipProgressUpdate(state, 'busy', now), false);
});

test('still skips rapid repeated visible states', () => {
  const now = 5_000;
  const state = { currentState: 'busy', lastChange: now - 100 };

  assert.equal(shouldSkipProgressUpdate(state, 'busy', now), true);
});

test('starts parent monitor when entering a visible state', () => {
  const state = { currentState: 'idle', lastChange: 0, pid: 0, monitorPid: 0 };

  assert.equal(shouldStartParentMonitor(state, 'busy', 123), true);
});

test('does not start parent monitor for idle state', () => {
  const state = { currentState: 'busy', lastChange: 0, pid: 123, monitorPid: 456 };

  assert.equal(shouldStartParentMonitor(state, 'idle', 123), false);
});

test('reuses live parent monitor for the same Codex process', () => {
  const state = { currentState: 'busy', lastChange: 0, pid: 123, monitorPid: 456 };

  assert.equal(shouldStartParentMonitor(state, 'paused', 123, () => true), false);
});

test('restarts parent monitor if the stored monitor died', () => {
  const state = { currentState: 'busy', lastChange: 0, pid: 123, monitorPid: 456 };

  assert.equal(shouldStartParentMonitor(state, 'error', 123, () => false), true);
});

test('resolves Codex session owner through a transient hook parent', () => {
  const processes = new Map([
    [200, { ppid: 100, args: '/bin/sh -c codex-terminal-progress hook tool-use' }],
    [100, { ppid: 1, args: 'node /usr/local/bin/codex' }],
  ]);

  assert.equal(resolveSessionOwnerPid(200, (pid) => processes.get(pid)), 100);
});

test('does not resolve this package as a Codex session owner', () => {
  const processes = new Map([
    [200, { ppid: 1, args: 'node /usr/local/bin/codex-terminal-progress hook tool-use' }],
  ]);

  assert.equal(resolveSessionOwnerPid(200, (pid) => processes.get(pid)), undefined);
});

test('persists idle state even if terminal write fails', () => {
  assert.equal(shouldPersistProgressState('idle', false), true);
  assert.equal(shouldPersistProgressState('busy', false), false);
  assert.equal(shouldPersistProgressState('busy', true), true);
});

test('clears progress when Codex stops after a completed response', () => {
  assert.deepEqual(progressStateForHookEvent('stop'), { progressState: 'idle', force: true });
});

test('clears progress when Codex sends a turn-ended notify event', () => {
  assert.deepEqual(progressStateForHookEvent('turn-ended'), { progressState: 'idle', force: true });
});

test('clears progress when Codex records task completion', () => {
  assert.deepEqual(progressStateForHookEvent('task_complete'), { progressState: 'idle', force: true });
});

test('resumes busy state when the user submits input', () => {
  assert.deepEqual(progressStateForHookEvent('user-prompt-submit'), { progressState: 'busy', force: false });
});

test('keeps progress visible after successful tool use completes', () => {
  assert.deepEqual(progressStateForHookEvent('post-tool-use', { tool_response: { exit_code: 0 } }), {
    progressState: 'busy',
    force: false,
  });
});

test('keeps error state after failed tool use', () => {
  assert.deepEqual(progressStateForHookEvent('post-tool-use', { tool_response: { exit_code: 1 } }), {
    progressState: 'error',
    force: false,
  });
});

test('clears stale busy progress for usage-limit notifications', () => {
  assert.deepEqual(
    progressStateForHookEvent('notification', {
      message: "You've hit your usage limit. Upgrade to Pro or try again later.",
    }),
    { progressState: 'idle', force: true },
  );
});

test('clears stale busy progress for generic notifications', () => {
  assert.deepEqual(progressStateForNotification({ message: 'Codex finished responding.' }), {
    progressState: 'idle',
    force: true,
  });
});

test('shows paused state for approval notifications', () => {
  assert.deepEqual(progressStateForNotification({ message: 'Waiting for your approval.' }), {
    progressState: 'paused',
    force: false,
  });
});
