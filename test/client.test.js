import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * 客户端冒烟测试：用最小的 react / document / fetch 替身，把 client.js 的工厂
 * 真正物化一遍，再把入口图标、隐藏消费者、弹窗（含「移动到工作区」）都渲染一次。
 *
 * 目的不是像素级验证，而是抓那些一打开就白屏的错误：hooks 顺序、未定义函数、
 * 假数据形状不匹配、prefill / dialog / move 状态机写错。
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
};

function element(type, props, children) {
  return { type, props: props === undefined ? null : props, children };
}

const fakeReact = {
  createElement(type, props, children) { return element(type, props, children); },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, function () {}]; },
  useEffect() {},
  useRef() { return { current: null }; },
};

let requests = [];
globalThis.fetch = async function fetch(url, options) {
  requests.push({ url, body: options !== undefined && options.body !== undefined ? JSON.parse(options.body) : null });
  const path = String(url);
  let payload = { ok: true };
  if (path.endsWith('/last-prompt')) {
    payload = {
      ok: true,
      seq: 7,
      prevSeq: 5,
      text: '上一次的提问',
      time: Date.now(),
      images: 1,
      files: 0,
      replied: true,
      header: { cwd: 'D:\\ws' },
    };
  } else if (path.endsWith('/describe')) {
    payload = {
      ok: true,
      session: { currentWorkspaceId: 'w1', canMove: true },
      workspaces: [
        { id: 'w1', title: '工作区一', path: 'D:\\a', current: true },
        { id: 'w2', title: '工作区二', path: 'D:\\b' },
      ],
    };
  } else if (path.endsWith('/move')) {
    payload = { ok: true, applied: 'attached', released: false, handedOff: false };
  }
  return { status: 200, async json() { return payload; } };
};

await import('../lib/client.js');

assert.notEqual(registered, null, 'client.js 应当注册一个模块工厂');
assert.equal(registered.id, 'dsh-session-extension');

const mod = registered.factory(function requireShim(name) {
  if (name === 'react') return fakeReact;
  throw new Error('unexpected require: ' + name);
});

function show(tree) {
  return JSON.stringify(tree, function (key, value) {
    return typeof value === 'function' ? '[fn]' : value;
  });
}

/** 元素树里是否出现了某个函数组件（函数组件不会在 JSON 里展开）。 */
function containsComponent(tree, component) {
  if (tree === null || typeof tree !== 'object') return false;
  if (tree.type === component) return true;
  if (Array.isArray(tree.children)) return tree.children.some(function (child) { return containsComponent(child, component); });
  return containsComponent(tree.children, component);
}

test('apply 只注册对话内的三个槽位', () => {
  const registrations = [];
  const injections = [];
  const ctx = {
    slots: {
      inject(name, callback) {
        injections.push(name);
        callback();
        return function () {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return function () {};
      },
    },
    inject(names, callback) {
      callback({
        locale: {
          register() {},
          subscribe() { return function () {}; },
          getLocale() { return { id: 'zh' }; },
          bind() { return function (key) { return key; }; },
        },
        sessions: { async fork() { return 'child-session'; } },
        uiWorkspace: { openSession() {} },
      });
    },
  };
  const dispose = mod.apply(ctx);
  assert.equal(typeof dispose, 'function');

  const names = registrations.map(function (entry) { return entry.options.name; });
  assert.deepEqual(names.sort(), [
    'conversation.chat.assistant-actions',
    'conversation.input.dock',
    'shell.overlay',
  ].sort());
  assert.ok(injections.indexOf('conversation.chat.assistant-actions') >= 0);
  // 左侧栏入口与菜单项都已经移除。
  assert.ok(injections.indexOf('sidebar.panellist') < 0);
  assert.ok(injections.indexOf('main') < 0);
  assert.ok(injections.indexOf('sidebar.workspaces.session.menu.item') < 0);
});

test('消息操作行的小图标：和官方按钮同类，点击可打开弹窗', () => {
  const tree = mod.__internal.AssistantAction({ sessionId: 'session-a', messageId: 'm1' });
  assert.equal(tree.type, 'button');
  assert.ok(String(tree.props.className).indexOf('dsse-action-icon') >= 0);
  assert.ok(String(tree.props.className).indexOf('_1KfHza_action') >= 0, '应当复用官方操作按钮类名');
  assert.equal(typeof tree.props.onClick, 'function');
  assert.equal(mod.__internal.AssistantAction({}), null);
});

test('隐藏的待载入消费者不渲染任何东西', () => {
  assert.equal(mod.__internal.PrefillConsumer({ sessionId: 'session-a', inputActions: { setDraft() {}, submit() {} } }), null);
});

test('对话框：初始为 null，打开后能渲染编辑框与移动入口', async () => {
  assert.equal(mod.__internal.DialogHost(), null);
  mod.__internal.openDialog({ sessionId: 'session-a', title: '会话 A' });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  const state = mod.__internal.dialogState();
  assert.equal(state.phase, 'ready');
  assert.equal(state.text, '上一次的提问');
  const tree = mod.__internal.DialogHost();
  const json = show(tree);
  assert.ok(json.indexOf('上一次的提问') >= 0);
  assert.ok(json.indexOf('重发并发送') >= 0);
  assert.ok(json.indexOf('仅载入输入框') >= 0);
  assert.ok(containsComponent(tree, mod.__internal.MoveSection), '对话框里应当挂上「移动到工作区」区');
  mod.__internal.closeDialog();
});

test('「仅载入输入框」把文本登记到对应会话的待载入表', async () => {
  mod.__internal.openDialog({ sessionId: 'session-b' });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  mod.__internal.loadIntoComposer();
  const pending = mod.__internal.prefillState();
  assert.equal(typeof pending['session-b'], 'object');
  assert.equal(pending['session-b'].text, '上一次的提问');
  assert.equal(pending['session-b'].submit, false);
  const taken = mod.__internal.takePrefill('session-b');
  assert.equal(taken.text, '上一次的提问');
  assert.equal(mod.__internal.takePrefill('session-b'), null);
});

test('「移动到工作区」：读取工作区、渲染目标、移动后显示回执', async () => {
  mod.__internal.openDialog({ sessionId: 'session-c' });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });

  mod.__internal.openMove();
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  let move = mod.__internal.dialogState().move;
  assert.equal(move.phase, 'ready');
  assert.equal(move.currentTitle, '工作区一');

  const section = show(mod.__internal.MoveSection());
  assert.ok(section.indexOf('工作区二') >= 0, '目标工作区应当出现在列表里');
  assert.ok(section.indexOf('工作区一') >= 0, '当前工作区名应当显示');
  assert.ok(section.indexOf('D:\\\\b') >= 0, '目标路径应当显示');

  mod.__internal.moveToWorkspace('w2');
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  move = mod.__internal.dialogState().move;
  assert.equal(move.phase, 'done');
  assert.ok(String(move.message).indexOf('已补上归属') >= 0, '回执应当包含 applied=attached 的说明');
  assert.ok(String(move.message).indexOf('刷新页面') >= 0, '回执应当提醒刷新');

  const moved = requests.filter(function (entry) { return entry.url.endsWith('/move'); });
  assert.equal(moved.length, 1);
  assert.equal(moved[0].body.sessionId, 'session-c');
  assert.equal(moved[0].body.targetWorkspaceId, 'w2');
  mod.__internal.closeDialog();
});

test('语言字典中英齐全', () => {
  const dict = mod.__internal.DICT;
  assert.deepEqual(Object.keys(dict.zh).sort(), Object.keys(dict.en).sort(), '中英字典的键必须一致');
  for (const key of Object.keys(dict.zh)) {
    assert.equal(typeof dict.zh[key], 'string');
    assert.equal(typeof dict.en[key], 'string');
  }
});

test('桥接前缀默认值可从全局引导覆盖', () => {
  assert.equal(mod.__internal.bridgePrefix(), '/api/dsh-session-extension');
  globalThis.__DSH_SESSION_EXTENSION__ = { prefix: '/custom/prefix/', version: '9.9.9' };
  assert.equal(mod.__internal.bridgePrefix(), '/custom/prefix');
  assert.equal(mod.__internal.pluginVersion(), '9.9.9');
  delete globalThis.__DSH_SESSION_EXTENSION__;
});
