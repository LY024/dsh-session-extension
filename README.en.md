# dsh-session-extension

[简体中文](README.md) | **English**

**Edit your last prompt and resend it — plus move, delete, and archive DSH conversations across workspaces.**

It adds four capabilities. Every entry point lives in the conversation view or on a sidebar session row — no extra sidebar page.

| Capability | Entry point |
| --- | --- |
| **Edit message & resend** | The **↩** icon right after the copy icon under the **last user message** (hover shows “Edit message”) |
| **Move conversation** | Session row **…** → **Move** (hover to open the workspace submenu); or **drag** the conversation onto another workspace |
| **Delete conversation** | Session row **…** → **Delete** (red); or **Ctrl + click** multi-select, then **Delete** in the footer bar |
| **Bulk archive / move / delete** | **Ctrl (⌘) + left click** to multi-select → sidebar footer action bar |

---

## 1. Edit a message and resend

1. Hover the **last user message** and click the **↩** icon right after the copy icon;
2. The message **turns into an inline editor in place** (full row width, light grey, no border, 16px radius) prefilled with that prompt, caret at the end. The message action row is hidden while editing;
3. Click **Send** (or `Ctrl/Cmd + Enter`), or **Cancel** to leave everything untouched.

**What Send does**: it forks a new branch *before* that message (carrying all history up to that point), drops the edited text into the new branch's composer, and sends it. **The original conversation is not modified at all** — it stays where it was, and the new branch gets a fork marker in its title.

If the conversation only contains that single prompt (no earlier history to fork from), Send degrades to “load the text into the current composer” and sends it as a new message.

> Implementation note: DSH only exposes an action slot for *assistant* messages; user messages have none. So this entry point is **DOM-injected** (a MutationObserver re-inserts it), reusing the official copy button's CSS classes so size, colour, and hover match. The tooltip is a custom bubble (no native `title`, so two tooltips never stack).

## 2. Move a conversation

### Via the menu

1. Hover a conversation in the sidebar and click **…**;
2. Pick **Move** (with a `›`). **Hovering it** opens a submenu on the **right side of the menu panel**, starting at the “Move” row and extending to the bottom of the window. It flips to the left side when there is no room on the right, and expands **upwards** (bottom edge aligned with the “Move” row) when the menu is near the bottom of the window;
3. Click a target workspace — the list refreshes immediately;
4. The last item is **Other directory…**: enter an absolute path; the directory is created and registered as a new workspace.

### Drag and drop

Drag a conversation onto another workspace's **group** (the folder row, any session row under it, or the gap between them) and drop. Dragging **inside its own group** stays the official reordering behaviour — the plugin only takes over in other groups.

### Ctrl multi-select (bulk operations)

Hold **Ctrl (⌘) + left click** on session rows to toggle selection, exactly like Windows File Explorer:

- Selected rows get a **tinted background** (no checkbox circles, no layout shift);
- The sidebar footer shows **N selected / Cancel / Archive / Delete / Move**;
- **Move** opens a target-workspace picker and moves each selected conversation; you can also drag the selection onto another workspace (moves the whole batch);
- **Release Ctrl and click anywhere** to leave multi-select; clicking a selected row only exits, it never opens the conversation;
- `Esc` or the footer **Cancel** also exits.

### Child conversations (on by default)

Subagent sessions (`origin: subagent`, hidden in the sidebar) follow their parent when it is moved or deleted. Each child goes through its own transaction, with per-item failure isolation. Turn this off in **Plugins → dsh-session-extension → Config**.

### Ungrouped sessions

If a session's `cwd` is already under a workspace directory but the registry has no membership, **Move** simply attaches it (receipt `applied: "attached"`) without touching a single file.

### Moving a conversation that is still answering

- **Open but idle**: `flush` → `detach` → probe until the write lease is free, then move files;
- **Actively running**: in-place handoff — swap the header `cwd` inside the writer chain and move files without interrupting the current turn.

To be honest: the running turn still finishes, but its tool working directory **remains the old one** (the in-memory header is frozen). Files and membership have moved; the conversation really runs in the new directory the next time it is opened. Set `moveLive` to `false` to refuse moving running conversations.

### Why moving is safe

Validate → release / take over write ownership → write a migration journal → copy the whole session
directory into `_session-move-staging/<opId>/` (invisible to the DSH scanner) → rewrite every
generation's header `cwd` in staging with **byte-for-byte self-verification** → atomic `rename` →
delete the source → update the workspace registry → invalidate projections.

**Rewrites happen in staging; the source directory is untouched until the rename.** Any failure rolls
back cleanly, and a process killed after the rename leaves only one intermediate state (“target complete,
source still there”), which the idempotent recovery pass finishes on the next start.

## 3. Delete a conversation

**Destructive: the log is physically removed and cannot be recovered.**

- Session row **…** → **Delete** (red trash icon and label, left-aligned with the other menu rows);
- Or **Ctrl + click** multi-select → footer **Delete**;
- A confirmation dialog appears first (custom, so it does not depend on `window.confirm`);
- A running conversation is **stopped first** (otherwise the log is locked); failures report the reason;
- Child subagent sessions are deleted too when “move child conversations” is enabled.

Deletion is transactional as well: the session directory is **atomically moved** into
`<sessionsRoot>/_session-delete-trash/<opId>/`, then membership and projections are cleaned up, and
only then is staging removed. A failure moves everything back. What gets deleted is the **session log**;
files inside the workspace directory are untouched.

## 4. Archive

DSH conversations can be archived and later restored. In multi-select, **Archive** calls the host's
archive API for each selected conversation, with per-item failure isolation and progress (“Archiving x/N…”).

---

## Installation

~~~bash
# From npm (once published):
dsh plugin --profile web add dsh-session-extension

# From source (replace with your clone):
dsh plugin --profile web add <path-to-your-checkout>
~~~

The host half is a Node module, so **restart `dsh web`** after installing (or use the Plugins page's
plugin manager, which tries to hot-load it).

Health check:

~~~bash
curl http://127.0.0.1:3080/api/dsh-session-extension/status
~~~

`{"ok":true, ...}` means the host is up; after refreshing the page, the **↩** icon should appear under
the last user message.

---

## Configuration

Keys read from this row's `config` in `cordis.patch.yml` (the profile layer may override them):

| Key | Default | Meaning |
| --- | --- | --- |
| `bridgePrefix` | `/api/dsh-session-extension` | HTTP bridge prefix; the client follows it through the boot global. |
| `journalsDir` | `<dsh home>/session-move` | Migration journal directory. |
| `sessionsRoot` | backend root, falling back to `<dsh home>/sessions` | Session storage root. Rarely needed. |
| `home` | `$DSH_HOME` or `~/.dsh` | DSH home. |
| `moveLive` | `true` | In-place handoff for running conversations; `false` refuses. |
| `releaseLive` | `true` | Automatically release open-but-idle conversations before moving; `false` refuses. |
| `dragMove` | `true` | Sidebar drag-to-move; turn off if DSH changes its DOM contract (the menu still works). |
| `releaseRetries` / `releaseRetryDelayMs` | `24` / `150` | Retries and delay when probing for a free write lease. |
| `verify` | `auto` | Post-move verification strength: `auto` or `full`. |
| `fullVerifyLimit` | `2097152` (2 MB) | Threshold for `verify: auto`. |
| `allowedHosts` | `[]` | Extra allowed `Host` hostnames (no port). Loopback + `webServer.host` are always allowed. |
| `allowedOrigins` | `[]` | Extra allowed `Origin`s, for a dev proxy. |
| `selftest` | `false` | Mounts a few `__selftest/*` routes. |
| `maxSessions` | `40` | Maximum rows returned by `/sessions` (cap 200). |
| `withTitles` | `false` | Whether `/sessions` also reads titles (only for ≤ 20 rows). |

## HTTP bridge

| Method | Path | Description |
| --- | --- | --- |
| POST | `<prefix>/describe` | `{ sessionId? }` → workspace list; with a sessionId also `currentWorkspaceId`, `live`, `willHandoff`, `willRelease`, `canMove`, `reason`. |
| POST | `<prefix>/move` | `{ sessionId, targetWorkspaceId }` or `{ sessionId, targetPath }` → migration receipt (`applied`, `released`, `handedOff`, `verification`). |
| POST | `<prefix>/move-commit` | `{ sessionIds }` → commit deferred membership for a batch. |
| POST | `<prefix>/last-prompt` | `{ sessionId }` → `{ seq, prevSeq, text, time, images, files, replied }`; `prevSeq` is the fork boundary used by edit-and-resend. |
| POST | `<prefix>/delete` | `{ sessionId \| sessionIds, includeChildren? }` → `{ deleted, failed, results[] }`; removes logs, membership, projections. |
| POST | `<prefix>/sessions` | `{ limit?, withTitles? }` → session catalog (headers only). |
| GET/POST | `<prefix>/status` | Version, config, pending migrations; also attempts recovery. |

Failures are always `{ ok: false, code, message }`. POSTs require `Content-Type: application/json`;
a rejected origin returns `403`, a wrong media type `415`, and bodies over 64 KB `413`.

## Security

The bridge is mounted directly on DSH's `node:http` with no cookies and no tokens, so the plugin
protects itself:

- **Host validation**: only loopback hostnames (`localhost`, `127.0.0.0/8`, `::1`) or the address
  `webServer.host` is bound to — blocks DNS rebinding;
- **Origin / Sec-Fetch-Site validation**: a present `Origin` must be same-origin; `Sec-Fetch-Site: cross-site`
  is rejected;
- **Strict JSON Content-Type**: ordinary CSRF “simple requests” are stopped at the CORS preflight
  (this service never answers preflights);
- **Path and journal validation**: `targetPath` must be absolute and must not fall inside the session
  storage root or the journal directory; recovery only accepts journals strictly inside the session
  storage root whose last path segment matches the encoded session id;
- **Deletion uses the same guards**: `sessionId` length is bounded, and only directories matching that id
  under the storage root are touched.

Every file/registry-mutating operation (`move`, `move-commit`, `delete`, crash recovery) runs on the same
**global serial queue**.

> These guards assume DSH serves on a loopback address. If you bind `webServer.host` to a LAN address,
> DSH itself has no user authentication — anyone on that network can call the bridge. Put it behind a
> reverse proxy with auth, or restrict it with a firewall.

---

## Known limitations

- **The edit entry point depends on the official user-message DOM** (`data-chat-flow-kind="user"` and the
  action row's `*_actions` class). If DSH changes those contracts, the icon may stop appearing;
- The inline editor is a DOM-injected node. During streaming, official re-renders can occasionally evict it
  (a MutationObserver re-inserts it and re-hides the bubble, but a brief flicker is possible);
- **Deletion is permanent**: logs are physically removed, and a running conversation is stopped first;
- **A running turn does not change its working directory** (the in-memory header is frozen); files and
  membership have moved and the change takes effect on the next open;
- After moving the conversation currently open on screen, refresh the page before opening it again;
- **Drag-to-move depends on official DOM contracts** (row attributes + group structure). Changes degrade
  gracefully; the menu path always works, and `dragMove: false` disables dragging entirely;
- The in-place handoff relies on private internals (`tracker.writers`, writer header slot, `enqueueChain`,
  registry `mutate`), each feature-detected: if probing fails it aborts as `handoff-failed` instead of
  leaving a half-moved session;
- The old “workspace chip” above the composer has been removed; all move entry points now live in the
  menu, drag-and-drop, and multi-select.

---

## Testing

~~~bash
node --test
~~~

| File | Coverage |
| --- | --- |
| `test/paths.test.js` | Session directory encoding vs. real `~/.dsh/sessions` names |
| `test/zstd.test.js` | Session log compression/decompression |
| `test/relocate.test.js` | Full migration / rollback / crash recovery (synthetic data) |
| `test/last-prompt.test.js` | “Last prompt” detection rules and fork boundary |
| `test/relocate-client.test.js` | Move UI (menu submenu, drag groups, Ctrl multi-select, footer bar, delete confirmation) |
| `test/client.test.js` | Edit entry point, prefill consumer, dialog |

**97 tests**, all with synthetic data — real conversations are never touched.

### Layout

~~~
src/last-prompt.js   Pure helpers: find the last prompt in an event stream
src/paths.js         Session directory encoding
src/relocate.js      Migration transaction (staging, header rewrite, atomic rename, journal, recovery)
src/zstd.js          Log compression/decompression
src/plugin.js        Host: bridge + origin checks + move/delete/rewrite routes
lib/client.js        Web: user-message edit entry, move UI (menu/drag/multi-select/footer)
test/                Unit tests
~~~

---

## References

The move capability is not written from scratch; it follows or reuses these projects/implementations:

- **[DDDMUC/dsh-session-relocate](https://github.com/DDDMUC/dsh-session-relocate)** —
  the original design and implementation of cross-workspace moving: the session menu’s “Move”, drag and
  drop, bulk multi-select, releasing idle sessions, in-place handoff for running conversations, and the
  “stage → rewrite header → atomic rename → update membership” migration flow. This plugin’s move
  behaviour is aligned with it.
- **This project’s earlier patched version (history of
  [LY024/dsh-session-extension](https://github.com/LY024/dsh-session-extension))** —
  the crash-recovery and safety hardening added on top of the original: byte-for-byte staging
  verification, rollback on failed `rename`, idempotent recovery on start/on call, origin validation and
  path constraints. This plugin keeps that transaction.
- **Official DSH client extension points** — public slots such as `dsh-client-ui-slots`,
  `conversation.input.dock`, `conversation.chat.*`, plus the official DOM contracts of user message and
  action rows. Every UI entry point goes through them; DSH itself is never patched.

Edit-message, the inline editor, and the delete/archive entry points are additions made by this plugin
on top of the above.

---

## License

GPL-3.0-or-later (same as the repository’s `LICENSE`).
