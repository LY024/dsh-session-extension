import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * 重发入口的冒烟测试：用最小的 react / document / fetch 替身把 client.js 物化，
 * 验证「编辑上次提问」图标、隐藏的待载入消费者和编辑弹窗能渲染、状态机正确。
 *
 * 搬会话那半边由 relocate-client.test.js 覆盖（它来自参考实现，更完整）。
 */

let registered = null;
globalThis.window = {
  __ModuleLoader__: {
    load(definition) { registered = definition; },
  },
};
globalThis.document = {
  querySelector() { return null; },
  createElement() { return { dataset: {}, style: {}, textContent: '' }; },
  head: { appendChild() {} },
  addEventListener() {},
  removeEventListener() {},
  dispatched: [],
  dispatchEvent(event) { this.dispatched.push(event); },
};

function element(type, props, children) {
  return { type, props: props === undefined ? null : props, children };
}

const fakeReact = {
  createElement(type, props, children) { return element(type, props, children); },
  cloneElement(node, extra) { return Object.assign({}, node, { props: Object.assign({}, node.props, extra) }); },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, function () {}]; },
  useEffect() {},
  useRef() { return { current: null }; },
};

let requests = [];
globalThis.fetch = async function fetch(url, options) {
  requests.push({ url: String(url), body: options !== undefined && options.body !== undefined ? JSON.parse(options.body) : null });
  const path = String(url);
  let payload = { ok: true };
  if (path.endsWith('/last-prompt')) {
    payload = { ok: true, seq: 7, prevSeq: 5, text: '上一次的提问', time: Date.now(), images: 0, files: 0, replied: true };
  }
  return { status: 200, async json() { return payload; } };
};

await import('../lib/client.js');

assert.notEqual(registered, null, 'client.js 应当注册一个模块工厂');
assert.equal(registered.id, 'dsh-session-extension');

const mod = registered.factory(function requireShim(name) {
  if (name === 'react') return fakeReact;
  // 模拟宿主没有 ui-primitives：Tooltip 应当退回原生 title。
  throw new Error('module not registered: ' + name);
});

const rewrite = mod.__rewrite;
assert.notEqual(rewrite, undefined, '应当导出重发的内部入口');

function show(tree) {
  return JSON.stringify(tree, function (key, value) {
    return typeof value === 'function' ? '[fn]' : value;
  });
}

test('apply 在搬移入口之外，额外注册重发图标、隐藏消费者和弹窗', () => {
  const slots = [];
  let registeredCount = 0;
  const ctx = {
    effect() {},
    inject(names, callback) {
      registeredCount += 1;
      callback({ sessions: { async fork() { return 'child-session'; } }, uiWorkspace: { openSession() {} } });
    },
    slots: {
      inject(name, factory) {
        slots.push(name);
        const value = factory();
        return typeof value === 'function' ? value : function () {};
      },
      register() { return function () {}; },
    },
  };
  const dispose = mod.apply(ctx);
  assert.equal(typeof dispose, 'function');
  assert.equal(slots.indexOf('conversation.chat.assistant-actions'), -1, '助手消息行不再注册入口');
  assert.ok(slots.indexOf('conversation.input.dock') >= 0, '应当注册隐藏的待载入消费者');
  assert.ok(slots.indexOf('shell.overlay') >= 0, '应当注册编辑弹窗');
  // 搬移入口仍在（与参考实现一致）。
  assert.ok(slots.indexOf('sidebar.workspaces.session.menu.item') >= 0);
  assert.ok(slots.indexOf('sidebar.footer.action') >= 0);
  assert.equal(typeof rewrite.decorateUserAction, 'function', '用户消息行用 DOM 注入');
  assert.equal(typeof rewrite.installUserAction, 'function');
  assert.equal(registeredCount, 2, 'sessions / uiWorkspace 各注入一次');
});

test('消息操作行图标：和官方按钮同类，带 hover 名字，点击打开弹窗', () => {
  const tree = rewrite.AssistantAction({ sessionId: 'session-a', messageId: 'm1' });
  assert.equal(tree.type, 'button');
  assert.ok(String(tree.props.className).indexOf('dsrw-action') >= 0);
  assert.ok(String(tree.props.className).indexOf('_1KfHza_action') >= 0, '应当复用官方操作按钮类名');
  assert.equal(tree.props.title, '编辑上次提问并重发');
  assert.equal(typeof tree.props.onClick, 'function');
  assert.equal(rewrite.AssistantAction({}), null);
});

test('隐藏的待载入消费者不渲染任何东西', () => {
  assert.equal(rewrite.PrefillConsumer({ sessionId: 'session-a', inputActions: { setDraft() {}, submit() {} } }), null);
});

test('对话框：初始为 null，打开后能渲染编辑框与两个按钮', async () => {
  assert.equal(rewrite.DialogHost(), null);
  rewrite.openDialog({ sessionId: 'session-a' });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  const state = rewrite.dialogState();
  assert.equal(state.phase, 'ready');
  assert.equal(state.text, '上一次的提问');
  const tree = rewrite.DialogHost();
  const json = show(tree);
  assert.ok(json.indexOf('上一次的提问') >= 0);
  assert.ok(json.indexOf('重发并发送') >= 0);
  assert.ok(json.indexOf('仅载入输入框') >= 0);
  rewrite.closeDialog();
});

test('「仅载入输入框」把文本登记到对应会话的待载入表', async () => {
  rewrite.openDialog({ sessionId: 'session-b' });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  rewrite.loadIntoComposer();
  const pending = rewrite.prefillState();
  assert.equal(typeof pending['session-b'], 'object');
  assert.equal(pending['session-b'].text, '上一次的提问');
  assert.equal(pending['session-b'].submit, false);
  const taken = rewrite.takePrefill('session-b');
  assert.equal(taken.text, '上一次的提问');
  assert.equal(rewrite.takePrefill('session-b'), null);
});

test('中英字典齐全', () => {
  assert.deepEqual(Object.keys(rewrite.zh).sort(), Object.keys(rewrite.en).sort());
  for (const key of Object.keys(rewrite.zh)) {
    assert.equal(typeof rewrite.zh[key], 'string');
    assert.equal(typeof rewrite.en[key], 'string');
  }
});
