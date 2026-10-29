import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countAttachments,
  findLastPrompt,
  hasReplyAfter,
  isAppendSurfaceEvent,
  textOfContent,
} from '../src/last-prompt.js';

/** 造一条用户提问事件（形状对齐 dsh-session-query 的 readSession().events）。 */
function prompt(seq, text, extra = {}) {
  return {
    seq,
    type: 'user/message',
    time: 1_700_000_000_000 + seq,
    surfaceOp: 'append',
    data: {
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user', rpcId: 'rpc-' + String(seq) },
      ...extra,
    },
  };
}

/** 造一条助手回答事件。 */
function answer(seq) {
  return {
    seq,
    type: 'assistant/message',
    time: 1_700_000_000_000 + seq,
    surfaceOp: 'append',
    data: {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      source: { kind: 'model' },
    },
  };
}

test('textOfContent 只拼文本块，字符串原样返回', () => {
  assert.equal(textOfContent('hello'), 'hello');
  assert.equal(textOfContent([{ type: 'text', text: 'a' }, { type: 'image', url: 'x' }, { type: 'text', text: 'b' }]), 'a\nb');
  assert.equal(textOfContent([{ type: 'image', url: 'x' }]), '');
  assert.equal(textOfContent(null), '');
});

test('countAttachments 分别数图片和文件', () => {
  const counts = countAttachments([
    { type: 'text', text: 'x' },
    { type: 'image', url: 'a' },
    { type: 'image', url: 'b' },
    { type: 'file', name: 'c.txt' },
  ]);
  assert.deepEqual(counts, { images: 2, files: 1 });
});

test('isAppendSurfaceEvent：缺 surfaceOp 的旧日志按追加处理，replace 不算', () => {
  assert.equal(isAppendSurfaceEvent({ surfaceOp: 'append' }), true);
  assert.equal(isAppendSurfaceEvent({}), true);
  assert.equal(isAppendSurfaceEvent({ surfaceOp: 'replace' }), false);
  assert.equal(isAppendSurfaceEvent(null), false);
});

test('findLastPrompt 取最后一条用户亲手发的提问，并给出 fork 边界', () => {
  const events = [prompt(0, '第一问'), answer(1), prompt(2, '第二问'), answer(3)];
  const found = findLastPrompt(events);
  assert.notEqual(found, null);
  assert.equal(found.index, 2);
  assert.equal(found.seq, 2);
  assert.equal(found.prevSeq, 1);
  assert.equal(found.text, '第二问');
  assert.equal(found.images, 0);
  assert.equal(found.files, 0);
});

test('findLastPrompt 跳过注入上下文 / 压缩检查点 / 替换副本', () => {
  const events = [
    prompt(0, '真正的问题'),
    answer(1),
    {
      seq: 2,
      type: 'user/message',
      time: 1,
      surfaceOp: 'append',
      data: { role: 'user', content: [{ type: 'text', text: '注入的上下文' }], source: { kind: 'context' } },
    },
    {
      seq: 3,
      type: 'user/message',
      time: 1,
      surfaceOp: 'replace',
      data: { role: 'user', content: [{ type: 'text', text: '模型面补丁' }], source: { kind: 'user' } },
    },
  ];
  const found = findLastPrompt(events);
  assert.equal(found.seq, 0);
  assert.equal(found.prevSeq, null);
  assert.equal(found.text, '真正的问题');
});

test('findLastPrompt 跳过空白文本（纯附件）和没有提问的会话', () => {
  assert.equal(findLastPrompt([prompt(0, '   ')]), null);
  assert.equal(findLastPrompt([]), null);
  assert.equal(findLastPrompt(null), null);
  assert.equal(findLastPrompt([answer(0)]), null);
});

test('findLastPrompt 把纯文本次序保留为第一条提问时 prevSeq 为 null', () => {
  const found = findLastPrompt([prompt(0, '只有一句话'), answer(1)]);
  assert.equal(found.prevSeq, null);
});

test('hasReplyAfter 只看那条提问之后是否落盘了助手回答', () => {
  const events = [prompt(0, '问'), answer(1), prompt(2, '再问')];
  assert.equal(hasReplyAfter(events, 0), true);
  assert.equal(hasReplyAfter(events, 2), false);
  assert.equal(hasReplyAfter(events, 99), false);
});
