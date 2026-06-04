import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('persists idle state even if terminal write fails', () => {
  assert.equal(shouldPersistProgressState('idle', false), true);
  assert.equal(shouldPersistProgressState('busy', false), false);
  assert.equal(shouldPersistProgressState('busy', true), true);
});
