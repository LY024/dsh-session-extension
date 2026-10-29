/**
 * dsh-session-extension —— 网页端。
 *
 * 入口只有一个：助手消息下方那排小图标里（复制图标后面、分叉图标前面），
 * 多一个「编辑上次提问」的回复箭头。点开是一个弹窗，能同时做两件事：
 *
 *   1. 编辑上一次提问 → 从那条消息之前 fork 出新分支，把改好的文字送进新分支的输入框
 *      （可以直接发送，也可以只载入）；
 *   2. 把这个会话移动到另一个工作区（以及「其它目录…」），复用主机侧的搬迁事务。
 *
 * 没有左侧栏页面、没有输入框上方的常驻按钮、没有会话行菜单项 —— 都在对话里完成。
 *
 * 形态是 DSH 客户端的 lazy-CJS 包：只注册一个工厂，模块体副作用在首次物化时才跑。
 * 唯一的外部依赖是 react（平台基座模块），因此不需要打包器。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-extension',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require('react');

    var DEFAULT_PREFIX = '/api/dsh-session-extension';
    var BOOT_GLOBAL = '__DSH_SESSION_EXTENSION__';
    var STYLE_ID = 'dsh-session-extension-styles';
    var NS = 'dsh-session-extension';
    /**
     * 官方消息操作行按钮的类名（当前 DSH 版本构建产物里的 CSS Module 名）。
     * 用它让图标按钮和「复制 / 分叉」完全同款；版本换了、类名不在了，
     * 下面的 dsse-action-icon 兜底样式仍然让它看起来是同一排的小图标。
     */
    var OFFICIAL_ACTION_CLASS = '_1KfHza_action';

    // ---- 样式 -------------------------------------------------------------
    var CSS = [
      // 消息操作行的小图标按钮（兜底样式对齐官方 MessageIconActions）
      '.dsse-action-icon{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));box-sizing:border-box;border-radius:var(--dsw-radius-sm,8px);color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));cursor:pointer;background:0 0;border:none;display:inline-flex;justify-content:center;align-items:center;padding:6px;flex:none}',
      '.dsse-action-icon svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px));display:block}',
      '.dsse-action-icon:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,inherit)}',
      '.dsse-action-icon:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c8dff);outline-offset:1px}',

      // 通用
      '.dsse-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;min-height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.45));background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;line-height:18px;cursor:pointer;white-space:nowrap}',
      '.dsse-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}',
      '.dsse-btn:disabled{opacity:.5;cursor:default}',
      '.dsse-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4c8dff);color:#fff}',
      '.dsse-btn-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary,#4c8dff);filter:brightness(1.06)}',
      '.dsse-btn-quiet{border-color:transparent;background:transparent;min-height:26px;padding:0 8px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}',
      '.dsse-icon{display:inline-flex;flex:none;color:currentColor}',
      '.dsse-icon svg{display:block}',

      // 弹窗
      '.dsse-backdrop{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:rgba(0,0,0,.42);pointer-events:auto}',
      '.dsse-dialog{display:flex;flex-direction:column;gap:12px;box-sizing:border-box;width:min(620px,94vw);max-height:min(80vh,760px);padding:18px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#1f232b));color:var(--dsw-alias-label-primary,inherit);box-shadow:0 18px 48px rgba(0,0,0,.36);overflow:auto}',
      '.dsse-dialog-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;line-height:22px}',
      '.dsse-dialog-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,inherit)}',
      '.dsse-dialog-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit);overflow-wrap:anywhere}',
      '.dsse-textarea{box-sizing:border-box;width:100%;min-height:140px;max-height:40vh;resize:vertical;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.45));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:13px;line-height:1.55;outline:none}',
      '.dsse-textarea:focus{border-color:var(--dsw-alias-brand-primary,#4c8dff)}',
      '.dsse-dialog-error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#ff453a);overflow-wrap:anywhere}',
      '.dsse-dialog-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
      '.dsse-spacer{flex:1}',
      '.dsse-loading{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit);padding:10px 2px}',
      '.dsse-spin{width:12px;height:12px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.5));border-top-color:var(--dsw-alias-brand-primary,#4c8dff);animation:dsse-spin .8s linear infinite;flex:none}',
      '@keyframes dsse-spin{to{transform:rotate(360deg)}}',

      // 「移动到工作区」折叠区
      '.dsse-move{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));padding-top:10px;display:flex;flex-direction:column;gap:8px}',
      '.dsse-move-head{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dsse-move-current{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,inherit);overflow-wrap:anywhere}',
      '.dsse-move-list{display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto;padding-right:2px}',
      '.dsse-move-item{display:flex;flex-direction:column;gap:2px;width:100%;box-sizing:border-box;text-align:left;padding:6px 8px;border-radius:8px;border:1px solid transparent;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:18px;cursor:pointer}',
      '.dsse-move-item:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}',
      '.dsse-move-item:disabled{opacity:.5;cursor:default}',
      '.dsse-move-name{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsse-move-path{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary,inherit);overflow-wrap:anywhere}',
      '.dsse-move-other{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dsse-move-input{flex:1;min-width:0;box-sizing:border-box;height:30px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.45));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:12px;outline:none}',
      '.dsse-move-input:focus{border-color:var(--dsw-alias-brand-primary,#4c8dff)}',
      '.dsse-move-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit);overflow-wrap:anywhere}',
      '.dsse-move-ok{color:var(--dsw-alias-state-success-primary,#2ea043)}',
    ].join('');

    function ensureStyles() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') !== null) return;
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-session-extension';
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // ---- 桥接 -------------------------------------------------------------
    function bootInfo() {
      if (typeof globalThis === 'undefined') return null;
      var value = globalThis[BOOT_GLOBAL];
      return value !== null && typeof value === 'object' ? value : null;
    }

    function bridgePrefix() {
      var boot = bootInfo();
      if (boot !== null && typeof boot.prefix === 'string' && boot.prefix.length > 0) {
        return boot.prefix.replace(/\/+$/, '');
      }
      return DEFAULT_PREFIX;
    }

    function pluginVersion() {
      var boot = bootInfo();
      return boot !== null && typeof boot.version === 'string' ? boot.version : '0.0.0';
    }

    function postJson(path, body) {
      var options = {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body !== undefined ? body : {}),
        credentials: 'same-origin',
        cache: 'no-store',
      };
      return fetch(bridgePrefix() + path, options).then(function (response) {
        return response.json().then(function (payload) { return payload; }, function () {
          return { ok: false, code: 'bad-response', message: 'HTTP ' + String(response.status) };
        });
      }, function (error) {
        return { ok: false, code: 'network-error', message: errorText(error) };
      });
    }

    function errorText(error) {
      if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message.length > 0) {
        return error.message;
      }
      return String(error);
    }

    // ---- 文案 -------------------------------------------------------------
    var DICT = {
      zh: {
        iconTitle: '编辑上次提问 / 移动到工作区',
        dialogTitle: '编辑上次提问',
        dialogHint: '改好的内容会成为新分支的第一句话；原会话不会被修改，随时可以回去。',
        forkNote: '将从「{time}」这条提问之前分叉',
        firstNote: '这是第一句提问，没有更早的历史可以分叉；只能载入输入框后作为新消息发送。',
        cancel: '取消',
        send: '重发并发送',
        loadOnly: '仅载入输入框',
        loading: '正在读取上一次提问…',
        failed: '读取失败',
        noPrompt: '这个会话里还没有可以编辑的提问',
        busy: '正在创建分支…',
        images: '{n} 张图片',
        files: '{n} 个文件',
        replied: '有旧回答',
        notReplied: '尚无回答',
        forkFailed: '分叉失败：',
        notReady: '插件还没就绪，请刷新页面后再试',
        moveToggle: '移动到工作区…',
        moveHide: '收起',
        moveCurrent: '当前工作区：{name}',
        moveUnknown: '未分组',
        moveLoading: '正在读取工作区…',
        moveEmpty: '没有其它可移动的工作区',
        moveOtherLabel: '其它目录…',
        movePlaceholder: '绝对路径，例如 D:\\work\\project',
        moveGo: '移动',
        moveBusy: '正在移动…',
        moveDone: '已移动',
        moveAttached: '已补上归属',
        movePending: '文件已搬完，归属会在下次启动时补齐',
        moveLive: '已在运行中接管，这一轮继续用旧目录',
        moveReload: '如果这是当前打开的会话，请刷新页面后再打开它。',
        moveFailed: '移动失败：',
        moveReleased: '已先释放打开中的会话',
        cannotMove: '这个会话现在不能移动：{reason}',
        version: 'v{version}',
      },
      en: {
        iconTitle: 'Edit previous prompt / Move to workspace',
        dialogTitle: 'Edit previous prompt',
        dialogHint: 'The edited text becomes the first message of a new branch. The original conversation is never modified.',
        forkNote: 'Forks right before the prompt from {time}',
        firstNote: 'This is the first prompt, so there is no earlier history to fork. It can only be loaded into the composer as a new message.',
        cancel: 'Cancel',
        send: 'Resend & send',
        loadOnly: 'Load into composer',
        loading: 'Reading the previous prompt…',
        failed: 'Failed to read',
        noPrompt: 'This session has no editable prompt yet',
        busy: 'Creating branch…',
        images: '{n} images',
        files: '{n} files',
        replied: 'Has a reply',
        notReplied: 'No reply yet',
        forkFailed: 'Fork failed: ',
        notReady: 'Plugin is not ready yet; refresh the page and try again',
        moveToggle: 'Move to workspace…',
        moveHide: 'Collapse',
        moveCurrent: 'Current workspace: {name}',
        moveUnknown: 'Ungrouped',
        moveLoading: 'Reading workspaces…',
        moveEmpty: 'No other workspace to move to',
        moveOtherLabel: 'Other directory…',
        movePlaceholder: 'Absolute path, e.g. D:\\work\\project',
        moveGo: 'Move',
        moveBusy: 'Moving…',
        moveDone: 'Moved',
        moveAttached: 'Workspace membership attached',
        movePending: 'Files moved; membership is completed on the next start',
        moveLive: 'Took over the live writer; this turn keeps the old directory',
        moveReload: 'If this is the open conversation, refresh the page and open it again.',
        moveFailed: 'Move failed: ',
        moveReleased: 'Released the open idle session first',
        cannotMove: 'This session cannot move now: {reason}',
        version: 'v{version}',
      },
    };

    var localeService = null;

    function dictionary() {
      var id = 'zh';
      if (localeService !== null && typeof localeService.getLocale === 'function') {
        try {
          var snap = localeService.getLocale();
          if (snap !== null && typeof snap === 'object' && typeof snap.id === 'string') id = snap.id;
        } catch (error) { id = 'zh'; }
      }
      return DICT[id] !== undefined ? DICT[id] : DICT.zh;
    }

    function t(key, vars) {
      var dict = dictionary();
      var text = typeof dict[key] === 'string' ? dict[key] : (typeof DICT.zh[key] === 'string' ? DICT.zh[key] : key);
      if (vars !== null && typeof vars === 'object') {
        text = text.replace(/\{([a-zA-Z0-9_]+)\}/g, function (match, name) {
          return vars[name] !== undefined ? String(vars[name]) : match;
        });
      }
      return text;
    }

    function useLocaleTick() {
      var state = react.useState(0);
      react.useEffect(function () {
        if (localeService === null || typeof localeService.subscribe !== 'function') return undefined;
        var off = localeService.subscribe(function () {
          state[1](function (n) { return n + 1; });
        });
        return typeof off === 'function' ? off : undefined;
      }, []);
      return state[0];
    }

    // ---- 服务引用 ---------------------------------------------------------
    var services = { sessions: null, uiWorkspace: null };

    // ---- 待载入输入框的文本 ------------------------------------------------
    var prefill = { items: Object.create(null), listeners: new Set() };

    function emitPrefill() {
      prefill.listeners.forEach(function (listener) {
        try { listener(); } catch (error) { /* ignore */ }
      });
    }

    function putPrefill(sessionId, item) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return;
      prefill.items[sessionId] = item;
      emitPrefill();
    }

    function takePrefill(sessionId) {
      var item = prefill.items[sessionId];
      if (item === undefined) return null;
      delete prefill.items[sessionId];
      return item;
    }

    function usePrefillTick() {
      var state = react.useState(0);
      react.useEffect(function () {
        function listener() { state[1](function (n) { return n + 1; }); }
        prefill.listeners.add(listener);
        return function () { prefill.listeners.delete(listener); };
      }, []);
      return state[0];
    }

    // ---- 弹窗状态 ----------------------------------------------------------
    var dialog = { state: null, listeners: new Set() };

    function emitDialog() {
      dialog.listeners.forEach(function (listener) {
        try { listener(); } catch (error) { /* ignore */ }
      });
    }

    function setDialog(patch) {
      if (dialog.state === null) return;
      dialog.state = Object.assign({}, dialog.state, patch);
      emitDialog();
    }

    function closeDialog() {
      dialog.state = null;
      emitDialog();
    }

    function emptyMove() {
      return { open: false, phase: 'idle', workspaces: [], currentId: null, currentTitle: '', canMove: true, reason: '', targetPath: '', message: '', receipt: null };
    }

    function openDialog(request) {
      var sessionId = request !== null && typeof request === 'object' ? request.sessionId : undefined;
      if (typeof sessionId !== 'string' || sessionId.length === 0) return;
      dialog.state = {
        sessionId: sessionId,
        title: typeof request.title === 'string' ? request.title : '',
        phase: 'loading',
        text: '',
        error: '',
        source: null,
        move: emptyMove(),
      };
      emitDialog();
      postJson('/last-prompt', { sessionId: sessionId }).then(function (result) {
        if (dialog.state === null || dialog.state.sessionId !== sessionId) return;
        if (result === null || typeof result !== 'object' || result.ok !== true) {
          var message = result !== null && typeof result === 'object' && typeof result.message === 'string'
            ? result.message
            : t('failed');
          var code = result !== null && typeof result === 'object' && result.code === 'no-prompt' ? 'no-prompt' : 'error';
          setDialog({ phase: 'error', error: code === 'no-prompt' ? t('noPrompt') : message, errorCode: code });
          return;
        }
        setDialog({ phase: 'ready', text: typeof result.text === 'string' ? result.text : '', source: result, error: '' });
      });
    }

    function useDialogState() {
      var state = react.useState(0);
      react.useEffect(function () {
        var listener = function () { state[1](function (n) { return n + 1; }); };
        dialog.listeners.add(listener);
        return function () { dialog.listeners.delete(listener); };
      }, []);
      return state[0];
    }

    // ---- 图标 -------------------------------------------------------------
    function replyPaths() {
      return [
        react.createElement('path', {
          key: 'head',
          d: 'M6.2 3.1 2.4 6.9l3.8 3.8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        react.createElement('path', {
          key: 'tail',
          d: 'M2.4 6.9h6.1a4.3 4.3 0 0 1 0 8.6H6.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      ];
    }

    function ReplyIcon(props) {
      var size = props !== null && typeof props === 'object' && typeof props.size === 'number' ? props.size : 15;
      return react.createElement('span', { className: 'dsse-icon', 'aria-hidden': 'true' }, react.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
      }, replyPaths()));
    }

    function FolderIcon(props) {
      var size = props !== null && typeof props === 'object' && typeof props.size === 'number' ? props.size : 14;
      return react.createElement('span', { className: 'dsse-icon', 'aria-hidden': 'true' }, react.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
      }, react.createElement('path', {
        d: 'M1.8 4.1c0-.5.4-.9.9-.9h2.6c.24 0 .47.1.63.27l1.1 1.13c.17.17.4.27.63.27h5.1c.5 0 .9.4.9.9v6.1c0 .5-.4.9-.9.9H2.7c-.5 0-.9-.4-.9-.9V4.1Z',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinejoin: 'round',
      })));
    }

    // ---- 工具 -------------------------------------------------------------
    function formatTime(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
      try {
        return new Intl.DateTimeFormat(undefined, {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(new Date(value));
      } catch (error) {
        return '';
      }
    }

    function sessionIdOf(props) {
      if (props === null || props === undefined) return undefined;
      if (typeof props.sessionId === 'string' && props.sessionId.length > 0) return props.sessionId;
      if (props.session !== null && props.session !== undefined && typeof props.session.id === 'string') return props.session.id;
      return undefined;
    }

    // ---- 动作 -------------------------------------------------------------
    function openSession(sessionId) {
      if (services.uiWorkspace !== null && typeof services.uiWorkspace.openSession === 'function') {
        services.uiWorkspace.openSession(sessionId);
        return true;
      }
      return false;
    }

    /** 把改好的文字送到某个会话的输入框（先登记，再打开）。 */
    function deliverText(sessionId, text, submit) {
      putPrefill(sessionId, { text: text, submit: submit === true });
      openSession(sessionId);
    }

    function loadIntoComposer() {
      if (dialog.state === null || dialog.state.phase !== 'ready') return;
      var text = dialog.state.text;
      if (text.trim().length === 0) return;
      deliverText(dialog.state.sessionId, text, false);
      closeDialog();
    }

    function forkAndSend() {
      if (dialog.state === null || dialog.state.phase !== 'ready') return;
      var state = dialog.state;
      var text = state.text;
      if (text.trim().length === 0) return;
      var source = state.source;
      var prevSeq = source !== null && typeof source === 'object' ? source.prevSeq : null;
      if (typeof prevSeq !== 'number') {
        setDialog({ error: t('firstNote') });
        return;
      }
      if (services.sessions === null || typeof services.sessions.fork !== 'function') {
        setDialog({ error: t('notReady') });
        return;
      }
      setDialog({ phase: 'busy', error: '' });
      var request = { sessionId: state.sessionId, atSeq: prevSeq, increaseTitle: true };
      Promise.resolve().then(function () {
        return services.sessions.fork(request);
      }).then(function (childId) {
        if (typeof childId !== 'string' || childId.length === 0) throw new Error('fork returned no session id');
        putPrefill(childId, { text: text, submit: true });
        if (!openSession(childId)) {
          takePrefill(childId);
          setDialog({ phase: 'ready', error: t('notReady') });
          return;
        }
        closeDialog();
      }, function (error) {
        setDialog({ phase: 'ready', error: t('forkFailed') + errorText(error) });
      });
    }

    // ---- 移动 -------------------------------------------------------------
    function setMove(patch) {
      if (dialog.state === null) return;
      var move = dialog.state.move !== null && typeof dialog.state.move === 'object' ? dialog.state.move : emptyMove();
      setDialog({ move: Object.assign({}, move, patch) });
    }

    function openMove() {
      if (dialog.state === null) return;
      var sessionId = dialog.state.sessionId;
      setMove({ open: true, phase: 'loading', workspaces: [], message: '', receipt: null, error: '' });
      postJson('/describe', { sessionId: sessionId }).then(function (result) {
        if (dialog.state === null || dialog.state.sessionId !== sessionId) return;
        if (result === null || typeof result !== 'object' || result.ok !== true) {
          setMove({ phase: 'error', message: result !== null && typeof result === 'object' && typeof result.message === 'string' ? result.message : t('failed') });
          return;
        }
        var session = result.session !== null && typeof result.session === 'object' ? result.session : {};
        var spaces = Array.isArray(result.workspaces) ? result.workspaces : [];
        var currentId = typeof session.currentWorkspaceId === 'string'
          ? session.currentWorkspaceId
          : (typeof session.cwdMatchesWorkspaceId === 'string' ? session.cwdMatchesWorkspaceId : null);
        var currentTitle = t('moveUnknown');
        for (var i = 0; i < spaces.length; i += 1) {
          if (spaces[i] !== null && spaces[i].id === currentId) currentTitle = spaces[i].title;
        }
        setMove({
          phase: 'ready',
          workspaces: spaces,
          currentId: currentId,
          currentTitle: currentTitle,
          canMove: session.canMove !== false,
          reason: typeof session.reason === 'string' ? session.reason : '',
        });
      });
    }

    function receiptText(receipt) {
      if (receipt === null || typeof receipt !== 'object') return t('moveDone');
      var parts = [];
      if (receipt.applied === 'attached') parts.push(t('moveAttached'));
      else if (receipt.applied === 'pending') parts.push(t('movePending'));
      else if (receipt.released === true) parts.push(t('moveReleased'));
      else parts.push(t('moveDone'));
      if (receipt.handedOff === true) parts.push(t('moveLive'));
      parts.push(t('moveReload'));
      return parts.join(' ');
    }

    function runMove(body) {
      if (dialog.state === null) return;
      var sessionId = dialog.state.sessionId;
      setMove({ phase: 'moving', message: '', receipt: null });
      postJson('/move', Object.assign({ sessionId: sessionId }, body)).then(function (result) {
        if (dialog.state === null || dialog.state.sessionId !== sessionId) return;
        if (result === null || typeof result !== 'object' || result.ok !== true) {
          setMove({ phase: 'ready', message: t('moveFailed') + (result !== null && typeof result === 'object' && typeof result.message === 'string' ? result.message : t('failed')) });
          return;
        }
        setMove({ phase: 'done', receipt: result, message: receiptText(result) });
      });
    }

    function moveToWorkspace(workspaceId) {
      runMove({ targetWorkspaceId: workspaceId });
    }

    function moveToTypedPath() {
      if (dialog.state === null) return;
      var move = dialog.state.move;
      var targetPath = move !== null && typeof move === 'object' && typeof move.targetPath === 'string' ? move.targetPath.trim() : '';
      if (targetPath.length === 0) return;
      runMove({ targetPath: targetPath });
    }

    // ---- 对话内的小图标入口（assistant-actions）-----------------------------
    function AssistantAction(props) {
      useLocaleTick();
      var sessionId = sessionIdOf(props);
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
      return react.createElement('button', {
        type: 'button',
        className: OFFICIAL_ACTION_CLASS + ' dsse-action-icon',
        title: t('iconTitle'),
        'aria-label': t('iconTitle'),
        onClick: function () {
          openDialog({ sessionId: sessionId });
        },
      }, react.createElement(ReplyIcon, { size: 15 }));
    }

    // ---- 待载入文字的消费者（隐藏；不占任何视觉位置）------------------------
    function PrefillConsumer(props) {
      var tick = usePrefillTick();
      var sessionId = sessionIdOf(props);
      var actions = props !== null && props !== undefined && props.inputActions !== null && typeof props.inputActions === 'object'
        ? props.inputActions
        : null;
      react.useEffect(function () {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return;
        if (actions === null || typeof actions.setDraft !== 'function') return;
        var item = takePrefill(sessionId);
        if (item === null) return;
        try {
          actions.setDraft(item.text);
        } catch (error) {
          return;
        }
        if (item.submit === true && typeof actions.submit === 'function') {
          // 让编辑器先吃掉 draft，再提交；没发出去也没关系，文字已经留在输入框里。
          setTimeout(function () {
            try { actions.submit(); } catch (error) { /* 输入框自己会提示 */ }
          }, 300);
        }
      }, [sessionId, tick]);
      return null;
    }

    // ---- 弹窗 -------------------------------------------------------------
    function MoveSection() {
      var state = dialog.state;
      if (state === null) return null;
      var move = state.move !== null && typeof state.move === 'object' ? state.move : emptyMove();
      var busy = move.phase === 'moving';
      var children = [];

      children.push(react.createElement('div', { className: 'dsse-move-head', key: 'head' }, [
        react.createElement('button', {
          key: 'toggle',
          type: 'button',
          className: 'dsse-btn dsse-btn-quiet',
          onClick: function () {
            if (move.open) setMove({ open: false });
            else openMove();
          },
          disabled: busy,
        }, [
          react.createElement(FolderIcon, { key: 'icon', size: 14 }),
          react.createElement('span', { key: 'label' }, move.open ? t('moveHide') : t('moveToggle')),
        ]),
        react.createElement('span', { key: 'current', className: 'dsse-move-current' }, t('moveCurrent', { name: move.currentTitle || t('moveUnknown') })),
      ]));

      if (move.open) {
        if (move.phase === 'loading') {
          children.push(react.createElement('div', { className: 'dsse-loading', key: 'loading' }, [
            react.createElement('span', { key: 'spin', className: 'dsse-spin' }),
            react.createElement('span', { key: 'text' }, t('moveLoading')),
          ]));
        } else if (move.canMove === false) {
          children.push(react.createElement('div', { className: 'dsse-move-note', key: 'cannot' }, t('cannotMove', { reason: move.reason || '—' })));
        } else {
          var targets = [];
          for (var i = 0; i < move.workspaces.length; i += 1) {
            var workspace = move.workspaces[i];
            if (workspace === null || typeof workspace !== 'object') continue;
            if (workspace.current === true) continue;
            targets.push(workspace);
          }
          if (targets.length === 0) {
            children.push(react.createElement('div', { className: 'dsse-move-note', key: 'empty' }, t('moveEmpty')));
          } else {
            children.push(react.createElement('div', { className: 'dsse-move-list', key: 'list' }, targets.map(function (workspace) {
              return react.createElement('button', {
                key: workspace.id,
                type: 'button',
                className: 'dsse-move-item',
                disabled: busy,
                onClick: function () { moveToWorkspace(workspace.id); },
              }, [
                react.createElement('span', { key: 'name', className: 'dsse-move-name' }, workspace.title),
                typeof workspace.path === 'string' && workspace.path.length > 0
                  ? react.createElement('span', { key: 'path', className: 'dsse-move-path' }, workspace.path)
                  : null,
              ]);
            })));
            children.push(react.createElement('div', { className: 'dsse-move-other', key: 'other' }, [
              react.createElement('input', {
                key: 'input',
                className: 'dsse-move-input',
                type: 'text',
                value: move.targetPath,
                placeholder: t('movePlaceholder'),
                'aria-label': t('moveOtherLabel'),
                disabled: busy,
                onChange: function (event) { setMove({ targetPath: event.target.value }); },
                onKeyDown: function (event) {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    moveToTypedPath();
                  }
                },
              }),
              react.createElement('button', {
                key: 'go',
                type: 'button',
                className: 'dsse-btn',
                disabled: busy || move.targetPath.trim().length === 0,
                onClick: moveToTypedPath,
              }, t('moveGo')),
            ]));
          }
        }
        if (busy) {
          children.push(react.createElement('div', { className: 'dsse-loading', key: 'busy' }, [
            react.createElement('span', { key: 'spin', className: 'dsse-spin' }),
            react.createElement('span', { key: 'text' }, t('moveBusy')),
          ]));
        } else if (typeof move.message === 'string' && move.message.length > 0) {
          children.push(react.createElement('div', {
            key: 'message',
            className: 'dsse-move-note' + (move.phase === 'done' ? ' dsse-move-ok' : ''),
          }, move.message));
        }
      }

      return react.createElement('div', { className: 'dsse-move' }, children);
    }

    function DialogHost() {
      useDialogState();
      useLocaleTick();
      var textareaRef = react.useRef(null);
      var state = dialog.state;
      var open = state !== null;
      var readySessionId = state !== null && state.phase === 'ready' ? state.sessionId : null;

      react.useEffect(function () {
        if (!open) return undefined;
        function onKeyDown(event) {
          if (event.key === 'Escape') {
            if (dialog.state !== null && dialog.state.phase === 'busy') return;
            event.stopPropagation();
            closeDialog();
          }
        }
        document.addEventListener('keydown', onKeyDown, true);
        return function () { document.removeEventListener('keydown', onKeyDown, true); };
      }, [open]);

      react.useEffect(function () {
        if (readySessionId === null) return;
        var node = textareaRef.current;
        if (node === null || node === undefined) return;
        try {
          node.focus();
          var length = node.value.length;
          node.setSelectionRange(length, length);
        } catch (error) { /* ignore */ }
      }, [readySessionId]);

      if (state === null) return null;

      var busy = state.phase === 'busy';
      var loadingPhase = state.phase === 'loading';
      var text = typeof state.text === 'string' ? state.text : '';
      var source = state.source;
      var prevSeq = source !== null && typeof source === 'object' ? source.prevSeq : null;
      var canFork = typeof prevSeq === 'number';
      var metaParts = [];
      if (state.title.length > 0) metaParts.push(state.title);
      if (source !== null && typeof source === 'object') {
        var when = formatTime(source.time);
        if (when.length > 0) metaParts.push(when);
        if (source.replied === true) metaParts.push(t('replied'));
        if (typeof source.images === 'number' && source.images > 0) metaParts.push(t('images', { n: source.images }));
        if (typeof source.files === 'number' && source.files > 0) metaParts.push(t('files', { n: source.files }));
      }

      var body = [];
      if (loadingPhase) {
        body.push(react.createElement('div', { className: 'dsse-loading', key: 'loading' }, [
          react.createElement('span', { key: 'spin', className: 'dsse-spin' }),
          react.createElement('span', { key: 'text' }, t('loading')),
        ]));
      } else if (state.phase === 'error') {
        body.push(react.createElement('div', { className: 'dsse-dialog-error', key: 'error' }, state.error));
      } else {
        body.push(react.createElement('textarea', {
          key: 'textarea',
          ref: textareaRef,
          className: 'dsse-textarea',
          value: text,
          spellCheck: false,
          onChange: function (event) { setDialog({ text: event.target.value }); },
          onKeyDown: function (event) {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              forkAndSend();
            }
          },
        }));
        body.push(react.createElement('p', { key: 'hint', className: 'dsse-dialog-hint' },
          canFork
            ? t('forkNote', { time: source !== null && typeof source === 'object' ? (formatTime(source.time) || '—') : '—' })
            : t('firstNote')));
        if (typeof state.error === 'string' && state.error.length > 0) {
          body.push(react.createElement('div', { key: 'err', className: 'dsse-dialog-error' }, state.error));
        }
      }

      var actions = [];
      if (busy) {
        actions.push(react.createElement('div', { key: 'busy', className: 'dsse-loading' }, [
          react.createElement('span', { key: 'spin', className: 'dsse-spin' }),
          react.createElement('span', { key: 'text' }, t('busy')),
        ]));
      }
      actions.push(react.createElement('span', { key: 'spacer', className: 'dsse-spacer' }));
      actions.push(react.createElement('button', {
        key: 'cancel',
        type: 'button',
        className: 'dsse-btn',
        disabled: busy,
        onClick: closeDialog,
      }, t('cancel')));
      if (state.phase === 'ready') {
        actions.push(react.createElement('button', {
          key: 'load',
          type: 'button',
          className: 'dsse-btn',
          disabled: busy || text.trim().length === 0,
          onClick: loadIntoComposer,
        }, t('loadOnly')));
        if (canFork) {
          actions.push(react.createElement('button', {
            key: 'send',
            type: 'button',
            className: 'dsse-btn dsse-btn-primary',
            disabled: busy || text.trim().length === 0,
            onClick: forkAndSend,
          }, t('send')));
        }
      }

      return react.createElement('div', {
        className: 'dsse-backdrop',
        key: 'backdrop',
        onMouseDown: function (event) {
          if (event.target !== event.currentTarget) return;
          if (dialog.state !== null && dialog.state.phase === 'busy') return;
          closeDialog();
        },
      }, react.createElement('div', {
        className: 'dsse-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('dialogTitle'),
      }, [
        react.createElement('div', { className: 'dsse-dialog-title', key: 'title' }, [
          react.createElement(ReplyIcon, { key: 'icon', size: 16 }),
          react.createElement('span', { key: 'text' }, t('dialogTitle')),
        ]),
        metaParts.length > 0
          ? react.createElement('div', { className: 'dsse-dialog-meta', key: 'meta' }, metaParts.map(function (part, index) {
            return react.createElement('span', { key: 'm' + index }, part);
          }))
          : null,
        react.createElement('p', { className: 'dsse-dialog-hint', key: 'dialogHint' }, t('dialogHint')),
      ].concat(body).concat([
        react.createElement('div', { className: 'dsse-dialog-actions', key: 'actions' }, actions),
        react.createElement(MoveSection, { key: 'move' }),
      ])));
    }

    // ---- 挂载 -------------------------------------------------------------
    var inject = ['slots'];

    function apply(ctx) {
      ensureStyles();

      ctx.inject(['locale'], function (scoped) {
        localeService = scoped.locale;
        try {
          scoped.locale.register(NS, { zh: DICT.zh, en: DICT.en });
        } catch (error) { /* 已注册过就算了 */ }
      });
      ctx.inject(['sessions'], function (scoped) {
        services.sessions = scoped.sessions;
      });
      ctx.inject(['uiWorkspace'], function (scoped) {
        services.uiWorkspace = scoped.uiWorkspace;
      });

      var disposers = [];

      // 唯一的入口：助手消息操作行里的小图标（复制后面、分叉前面）。
      disposers.push(ctx.slots.inject('conversation.chat.assistant-actions', function () {
        return ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'session-extension-edit',
          order: 20,
        }, AssistantAction);
      }));

      // 隐藏的待载入消费者：分叉后把文字放进新会话的输入框。
      disposers.push(ctx.slots.inject('conversation.input.dock', function () {
        return ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'session-extension-prefill',
          order: 13,
        }, PrefillConsumer);
      }));

      // 弹窗画在 shell.overlay（整帧浮动层），不会被会话切换带走。
      disposers.push(ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-extension-dialog',
        }, DialogHost);
      }));

      return function () {
        for (var i = 0; i < disposers.length; i += 1) {
          if (typeof disposers[i] === 'function') {
            try { disposers[i](); } catch (error) { /* ignore */ }
          }
        }
      };
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__internal = {
      DICT: DICT,
      bridgePrefix: bridgePrefix,
      pluginVersion: pluginVersion,
      openDialog: openDialog,
      closeDialog: closeDialog,
      forkAndSend: forkAndSend,
      loadIntoComposer: loadIntoComposer,
      deliverText: deliverText,
      putPrefill: putPrefill,
      takePrefill: takePrefill,
      prefillState: function () { return prefill.items; },
      dialogState: function () { return dialog.state; },
      openMove: openMove,
      moveToWorkspace: moveToWorkspace,
      moveToTypedPath: moveToTypedPath,
      setMove: setMove,
      AssistantAction: AssistantAction,
      PrefillConsumer: PrefillConsumer,
      DialogHost: DialogHost,
      MoveSection: MoveSection,
    };
    return module.exports;
  },
});
