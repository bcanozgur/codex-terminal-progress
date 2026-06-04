import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, createOscWriter, normalizeTtyPath, ttyPathCandidates } from '../src/osc.js';

test('normalizes tty names into device paths', () => {
  assert.equal(normalizeTtyPath('ttys003'), '/dev/ttys003');
  assert.equal(normalizeTtyPath('/dev/ttys004'), '/dev/ttys004');
  assert.equal(normalizeTtyPath('??'), undefined);
  assert.equal(normalizeTtyPath('pts/1'), undefined);
});

test('compares terminal versions numerically', () => {
  assert.equal(compareVersions('3.6.6', '3.6.6'), 0);
  assert.equal(compareVersions('3.10.0', '3.6.6'), 1);
  assert.equal(compareVersions('3.4.15', '3.6.6'), -1);
});

test('builds tty candidates from inherited and parent terminal paths', () => {
  const candidates = ttyPathCandidates({
    env: { TTY: 'ttys001', SSH_TTY: '/dev/ttys002' },
    parentPid: 123,
    parentTtyPath: () => 'ttys003',
  });

  assert.deepEqual(candidates, ['/dev/tty', '/dev/ttys001', '/dev/ttys002', '/dev/ttys003']);
});

test('falls back to parent tty when /dev/tty cannot be opened', () => {
  const opened = [];
  const writes = [];
  const writer = createOscWriter({
    env: { TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.6.6' },
    parentPid: 123,
    parentTtyPath: () => 'ttys009',
    openFile: (path) => {
      opened.push(path);
      if (path === '/dev/ttys009') return 42;
      throw new Error('unavailable tty');
    },
    writeFile: (fd, data) => writes.push({ fd, data }),
  });

  assert.equal(writer.supported, true);
  assert.equal(writer.ttyPath, '/dev/ttys009');
  assert.deepEqual(opened, ['/dev/tty', '/dev/ttys009']);

  writer.osc('3');
  assert.deepEqual(writes, [{ fd: 42, data: '\x1b]9;4;3\x07' }]);
});

test('uses parent process tree resolver when direct tty is absent', () => {
  const opened = [];
  const writer = createOscWriter({
    env: { TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.6.6' },
    parentPid: 456,
    parentTtyPath: (pid) => {
      assert.equal(pid, 456);
      return '/dev/ttys010';
    },
    openFile: (path) => {
      opened.push(path);
      if (path === '/dev/ttys010') return 7;
      throw new Error('unavailable tty');
    },
  });

  assert.equal(writer.supported, true);
  assert.equal(writer.ttyPath, '/dev/ttys010');
  assert.deepEqual(opened, ['/dev/tty', '/dev/ttys010']);
});

test('rejects iTerm versions without OSC 9;4 progress support', () => {
  const writer = createOscWriter({
    env: { TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.4.15' },
    openFile: () => 42,
  });

  assert.equal(writer.supported, false);
  assert.equal(writer.terminal, 'iterm2');
  assert.equal(writer.issue.code, 'iterm-version-too-old');
});

test('reports unsupported when terminal progress is disabled', () => {
  const writer = createOscWriter({
    env: {
      TERM_PROGRAM: 'iTerm.app',
      CODEX_TERMINAL_PROGRESS: '0',
    },
    openFile: () => 42,
  });

  assert.equal(writer.supported, false);
});
