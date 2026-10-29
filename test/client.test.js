import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * 客户端冒烟测试：用最小的 react / document / fetch 替身，把 client.js 的
 * 工厂真正物化一遍，再把四个入口组件都「渲染」一次（只调用组件函数，不碰 DOM）。
 *
 * 目的不是像素级验证，而是抓那些一打开就白屏的错误：hooks 调用顺序、未定义函数、
 * 假数据形状不匹配、prefill / dialog 状态机写错。
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

let fetched = [];
globalThis.fetch = async function fetch(url, options) {
  fetched.push({ url, options });
  return {
    status: 200,
    async json() {
      return {
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
    },
  };
};

await import('../lib/client.js');

assert.notEqual(registered, null, 'client.js 应当注册一个模块工厂');
assert.equal(registered.id, 'dsh-session-extension');

const mod = registered.factory(function requireShim(name) {
  if (name === 'react') return fakeReact;
  throw new Error('unexpected require: ' + name);
});

assert.equal(typeof mod.apply, 'function');
assert.deepEqual(mod.inject, ['slots']);

test('apply 把五个槽位都注册上了', () => {
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
      const scoped = {
        locale: {
          register() {},
          subscribe() { return function () {}; },
          getLocale() { return { id: 'zh' }; },
          bind() { return function (key) { return key; }; },
        },
        sessions: { async fork() { return 'child-session'; } },
        uiWorkspace: { openSession() {} },
      };
      callback(scoped);
    },
  };
  const dispose = mod.apply(ctx);
  assert.equal(typeof dispose, 'function');

  const names = registrations.map(function (entry) { return entry.options.name; });
  assert.deepEqual(names.sort(), [
    'conversation.input.dock',
    'main',
    'shell.overlay',
    'sidebar.panellist',
    'sidebar.workspaces.session.menu.item',
  ].sort());
  assert.ok(injections.indexOf('sidebar.panellist') >= 0);
  assert.ok(injections.indexOf('main') >= 0);
  assert.ok(injections.indexOf('shell.overlay') >= 0);

  const panel = registrations.find(function (entry) { return entry.options.name === 'main'; });
  assert.equal(panel.options.key, mod.__internal.panelId);
});

test('面板能把会话列表渲染出来', () => {
  const sessionState = {
    ids: ['session-a', 'session-b'],
    byId: {
      'session-a': { id: 'session-a', displayTitle: '会话 A', updatedAt: 1_700_000_000_000, running: true, cwd: 'D:\\a' },
      'session-b': { id: 'session-b', displayTitle: '会话 B', updatedAt: 1_600_000_000_000, blank: false, cwd: 'D:\\b' },
      'session-c': { id: 'session-c', displayTitle: '子代理', origin: 'subagent' },
      'session-d': { id: 'session-d', displayTitle: '已归档', cwd: 'D:\\d' },
    },
  };
  const workspaceState = {
    items: [
      { workspaceId: 'w1', title: '工作区一', path: 'D:\\a', sessionIds: ['session-a'] },
    ],
    archivedSessionIds: ['session-d'],
  };
  const tree = mod.__internal.Panel({
    useSessions(selector) { return selector(sessionState); },
    useWorkspaces(selector) { return selector(workspaceState); },
  });
  assert.equal(tree.type, 'div');
  assert.equal(tree.props.className, 'dsse-panel');
  const json = JSON.stringify(tree, function (key, value) {
    // 元素树里有函数（onClick 等），序列化时跳过。
    return typeof value === 'function' ? '[fn]' : value;
  });
  assert.ok(json.indexOf('会话 A') >= 0, '应当渲染会话标题');
  assert.ok(json.indexOf('会话 B') >= 0);
  assert.ok(json.indexOf('子代理') < 0, '子代理会话应当被过滤');
  assert.ok(json.indexOf('已归档') < 0, '归档会话应当被过滤');
  assert.ok(json.indexOf('工作区一') >= 0, '应当显示所属工作区');
});

test('composer 入口在普通会话渲染、在空白会话不渲染', () => {
  const actions = { setDraft() {}, submit() {} };
  const normal = mod.__internal.DockChip({
    sessionId: 'session-a',
    session: { blank: false },
    inputActions: actions,
  });
  assert.equal(normal.type, 'div');
  const json = JSON.stringify(normal, function (key, value) {
    return typeof value === 'function' ? '[fn]' : value;
  });
  assert.ok(json.indexOf('编辑上次提问') >= 0, '普通会话应当出现「编辑上次提问」');
  assert.equal(mod.__internal.DockChip({ sessionId: 'session-blank', session: { blank: true }, inputActions: actions }), null);
});

test('会话行菜单项渲染一个 menuitem 按钮', () => {
  const tree = mod.__internal.MenuItem({ sessionId: 'session-a' });
  assert.equal(tree.type, 'button');
  assert.equal(tree.props.role, 'menuitem');
});

test('对话框：初始为 null，打开后能渲染出编辑框', async () => {
  assert.equal(mod.__internal.DialogHost(), null);
  mod.__internal.openDialog({ sessionId: 'session-a', title: '会话 A' });
  // 等 fetch 的 then 链跑完。
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  const state = mod.__internal.dialogState();
  assert.equal(state.phase, 'ready');
  assert.equal(state.text, '上一次的提问');
  const tree = mod.__internal.DialogHost();
  assert.equal(tree.type, 'div');
  assert.equal(tree.props.className, 'dsse-backdrop');
  const json = JSON.stringify(tree, function (key, value) {
    return typeof value === 'function' ? '[fn]' : value;
  });
  assert.ok(json.indexOf('上一次的提问') >= 0);
  assert.ok(json.indexOf('重发并发送') >= 0, '有 prevSeq 时应当有「重发并发送」');
  assert.ok(json.indexOf('仅载入输入框') >= 0);
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
  // 取走一次之后就没了。
  const taken = mod.__internal.takePrefill('session-b');
  assert.equal(taken.text, '上一次的提问');
  assert.equal(mod.__internal.takePrefill('session-b'), null);
});

test('语言字典中英齐全、占位符能替换', () => {
  const dict = mod.__internal.DICT;
  const zhKeys = Object.keys(dict.zh).sort();
  const enKeys = Object.keys(dict.en).sort();
  assert.deepEqual(zhKeys, enKeys, '中英字典的键必须一致');
  for (const key of zhKeys) {
    assert.equal(typeof dict.zh[key], 'string');
    assert.equal(typeof dict.en[key], 'string');
  }
});

test('桥接前缀默认值可从全局引导覆盖', () => {
  assert.equal(mod.__internal.bridgePrefix(), '/api/dsh-session-extension');
  globalThis.__DSH_SESSION_EXTENSION__ = { prefix: '/custom/prefix/', version: '9.9.9' };
  assert.equal(mod.__internal.bridgePrefix(), '/custom/prefix');
  delete globalThis.__DSH_SESSION_EXTENSION__;
});
