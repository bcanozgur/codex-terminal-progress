import test from 'node:test';
import assert from 'node:assert/strict';
import { updateNotifyConfig } from '../src/setup.js';

test('adds terminal progress notify when no notify command exists', () => {
  const existing = 'model = "gpt-5.5"\n\n[features]\nhooks = true\n';

  const result = updateNotifyConfig(existing);

  assert.equal(result.changed, true);
  assert.equal(result.action, 'added');
  assert.match(result.config, /^model = "gpt-5\.5"\n\nnotify = \["codex-terminal-progress", "notify", "turn-ended"\]\n\[features\]/);
});

test('chains existing notify command after terminal progress notify', () => {
  const existing = 'notify = ["/path/With Spaces/App", "turn-ended"]\n\n[features]\nhooks = true\n';

  const result = updateNotifyConfig(existing);

  assert.equal(result.changed, true);
  assert.equal(result.action, 'chained');
  assert.match(
    result.config,
    /^notify = \["codex-terminal-progress", "notify-chain", "turn-ended", "\/path\/With Spaces\/App", "turn-ended"\]/,
  );
});

test('leaves terminal progress notify command unchanged', () => {
  const existing = 'notify = ["codex-terminal-progress", "notify", "turn-ended"]\n';

  const result = updateNotifyConfig(existing);

  assert.deepEqual(result, { config: existing, changed: false, action: 'unchanged' });
});

test('leaves terminal progress notify chain unchanged', () => {
  const existing = 'notify = ["codex-terminal-progress", "notify-chain", "turn-ended", "/path/app"]\n';

  const result = updateNotifyConfig(existing);

  assert.deepEqual(result, { config: existing, changed: false, action: 'unchanged' });
});
