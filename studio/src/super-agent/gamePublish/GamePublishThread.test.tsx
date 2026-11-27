// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SuperAgentMessage } from '../../../../shared/super-agent';
import { I18nProvider } from '../../i18n/I18n';
import { countConversationTurns } from '../ExecutionTimeline';
import { GamePublishThread, GamePublishTurnEntries, partitionPublishEntries } from './GamePublishThread';
import { OpenDesignProgress, wechatInlineControlFlags } from './WechatProgress';
import { gamePublishActions, gamePublishSessionFor, gamePublishThreadFor, resetGamePublishStore } from './gamePublishStore';

const { publishMock, wxMock } = vi.hoisted(() => ({
  publishMock: vi.fn(),
  wxMock: {
    state: vi.fn(),
    saveKey: vi.fn(),
  },
}));
vi.mock('../../components/webPublishClient', () => {
  class WebPublishApiError extends Error {
    constructor(readonly code: string, message: string, readonly status: number) { super(message); }
  }
  return { WebPublishApiError, webPublishClient: { publish: (...args: unknown[]) => publishMock(...args) } };
});

vi.mock('./wechatClient', async importOriginal => ({
  ...(await importOriginal<typeof import('./wechatClient')>()),
  wechatClient: wxMock,
}));

vi.mock('../../motion/superAgentHandoff', () => ({ queueSuperAgentHandoff: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WECHAT_KEYS = ['account', 'appid', 'key', 'ip', 'port', 'preview', 'upload', 'testers', 'category', 'review', 'filing', 'release'] as const;
function makeWechatStatus(current: (typeof WECHAT_KEYS)[number] | null, extra: Record<string, unknown> = {}) {
  const at = current ? WECHAT_KEYS.indexOf(current) : WECHAT_KEYS.length;
  return {
    gameId: 'abc',
    appid: at > 1 ? 'wxd689822cb07d2570' : null,
    hasKey: at > 2,
    current,
    preview: null,
    steps: WECHAT_KEYS.map((key, index) => ({ key, status: index < at ? 'done' : 'todo', later: index >= 8 })),
    ...extra,
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('GamePublishThread', () => {
  afterEach(() => {
    resetGamePublishStore();
    publishMock.mockReset();
    wxMock.state.mockReset();
    wxMock.saveKey.mockReset();
  });

  it('keeps Douyin steps actionable and removes instructions already delivered by the current Agent reply', async () => {
    const artifactId = 'game:abc';
    const chatId = 'chat-1';
    const heading = 'Step 1 of 3 · Get a Mini Game AppID';
    const consoleUrl = 'https://developer.open-douyin.com/console';
    const guide = `**${heading}**\n\nRegister a game in the [developer console](${consoleUrl}) and copy its AppID.`;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onOpenPanel = vi.fn();
    const render = (messages: SuperAgentMessage[]) => act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <GamePublishThread chatId={chatId} messages={messages} onOpenPanel={onOpenPanel} />
        </I18nProvider>,
      );
    });
    const consoleLink = () => host.querySelector(`a[href="${consoleUrl}"]`);
    const done = () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Done');

    try {
      gamePublishActions.open({ artifactId, chatId, gameId: 'abc', gameTitle: 'Slingshot' });
      gamePublishActions.setLinkToo(artifactId, false);
      gamePublishActions.choose(artifactId, 'douyin-minigame');
      const requestedAt = gamePublishSessionFor(artifactId)!.guideRequestedAt!;
      expect(requestedAt).toBeTypeOf('number');
      const oldGuide: SuperAgentMessage = { id: 'old', role: 'assistant', status: 'completed', text: guide, createdAt: requestedAt - 1 };
      const current: SuperAgentMessage = { id: 'current', role: 'assistant', status: 'streaming', text: guide, createdAt: requestedAt + 1 };
      const unrelated: SuperAgentMessage = { ...current, id: 'unrelated', status: 'completed', text: 'The OpenDesign play link is ready.' };

      await render([oldGuide, unrelated, current]);
      expect(host.textContent).toContain(heading);
      expect(host.textContent).toContain('Copy the AppID');
      expect(consoleLink()).not.toBeNull();
      expect(done()?.disabled).toBe(false);

      await render([oldGuide, { ...current, status: 'completed', text: `**${heading}**` }]);
      expect(host.textContent).toContain('Copy the AppID');

      await render([{ ...current, status: 'completed', text: `**${heading}**\n\nRegister the mini game and copy its AppID.` }]);
      expect(host.textContent).not.toContain(heading);
      expect(host.textContent).not.toContain('Copy the AppID');
      expect(consoleLink()).not.toBeNull();

      await render([{ ...current, status: 'completed' }]);
      expect(host.textContent).not.toContain(heading);
      expect(consoleLink()).toBeNull();
      expect(done()?.disabled).toBe(false);
      await act(async () => { done()!.click(); });
      expect(gamePublishSessionFor(artifactId)?.stepIndex).toBe(1);
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });

  it('anchors historical OpenDesign link and saved-key receipts to their turns so WeChat step controls stay unobstructed', async () => {
    const artifactId = 'game:abc';
    const chatId = 'chat-wx';
    publishMock.mockResolvedValue({ url: 'https://play.opendesign.app/g/abc', updated: false, publication: {}, deployment: {} });
    wxMock.state.mockResolvedValue(makeWechatStatus('key'));
    wxMock.saveKey.mockResolvedValue({ appid: 'wxd689822cb07d2570', hasKey: true, savedAt: 'now' });

    gamePublishActions.syncChatTurnCount(chatId, 1);
    gamePublishActions.open({
      artifactId,
      chatId,
      gameId: 'abc',
      gameTitle: 'Skewer',
      link: { targetId: 'abc', filePath: 'index.html', title: 'Skewer' },
    });
    gamePublishActions.choose(artifactId, 'wechat');
    await flushMicrotasks();

    // Turn 1 (turnCount = 2): link entry stays in tail right below Turn 1, and WeChat active control renders above it if present.
    const atTurn1 = partitionPublishEntries(gamePublishThreadFor(chatId), 2);
    expect(atTurn1.byTurn.size).toBe(0);
    expect(atTurn1.tail).toHaveLength(1);

    // Turn 3 (turnCount = 4): Turn 1's OpenDesign link is partitioned into Turn 1 history, leaving Turn 3 tail empty for .key picker.
    gamePublishActions.syncChatTurnCount(chatId, 4);
    const atTurn3 = partitionPublishEntries(gamePublishThreadFor(chatId), 4);
    expect(atTurn3.byTurn.get(1)).toHaveLength(1);
    expect(atTurn3.tail).toHaveLength(0);

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      // Render Turn 1 historical entries + Turn 3 active thread.
      await act(async () => {
        root.render(
          <I18nProvider initialLocale="en">
            <div data-turn="1">
              <GamePublishTurnEntries entries={atTurn3.byTurn.get(1) ?? []} activeInline onOpenPanel={vi.fn()} />
            </div>
            <div data-tail>
              <GamePublishThread chatId={chatId} entries={atTurn3.tail} onOpenPanel={vi.fn()} />
            </div>
          </I18nProvider>,
        );
      });
      const turn1Box = host.querySelector('[data-turn="1"]')!;
      const tailBox = host.querySelector('[data-tail]')!;
      expect(turn1Box.querySelector('.om-gp-link-bar')).not.toBeNull();
      expect(turn1Box.textContent).toContain('Live on OpenDesign');
      expect(turn1Box.textContent).toContain('Open');
      expect(turn1Box.textContent).toContain('Copy link');
      // Turn 3 tail has ONLY the .key chooser, never separated by the Step 1 OpenDesign card.
      expect(tailBox.textContent).toContain('Choose the .key file');
      expect(tailBox.textContent).not.toContain('Live on OpenDesign');

      // Save key in Turn 3, then advance to Turn 4 (IP allowlist): both receipts stay in history, tail renders nothing.
      wxMock.state.mockResolvedValue(makeWechatStatus('ip'));
      await act(async () => {
        await gamePublishActions.saveWechatKey(artifactId, 'PRIVATE-KEY');
      });
      gamePublishActions.syncChatTurnCount(chatId, 5);
      const atTurn4 = partitionPublishEntries(gamePublishThreadFor(chatId), 5);
      expect(atTurn4.byTurn.get(1)).toHaveLength(1);
      expect(atTurn4.byTurn.get(3)).toHaveLength(1);
      expect(atTurn4.tail).toHaveLength(0);

      await act(async () => {
        root.render(
          <I18nProvider initialLocale="en">
            <div data-turn="3">
              <GamePublishTurnEntries entries={atTurn4.byTurn.get(3) ?? []} activeInline onOpenPanel={vi.fn()} />
            </div>
            <div data-tail>
              <GamePublishThread chatId={chatId} entries={atTurn4.tail} onOpenPanel={vi.fn()} />
            </div>
          </I18nProvider>,
        );
      });
      expect(host.querySelector('[data-turn="3"] .om-gp-receipt')?.textContent).toContain('Saved the upload key');
      expect(host.querySelector('[data-tail] .om-gp-thread')).toBeNull();
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });

  it('refreshes WeChat status on new completed assistant turns even when the publish panel is hidden, and exposes link actions in OpenDesignProgress', async () => {
    const artifactId = 'game:abc';
    const chatId = 'chat-hidden';
    publishMock.mockResolvedValue({ url: 'https://play.opendesign.app/g/abc', updated: false, publication: {}, deployment: {} });
    wxMock.state.mockResolvedValueOnce(makeWechatStatus('appid'));

    gamePublishActions.open({
      artifactId,
      chatId,
      gameId: 'abc',
      gameTitle: 'Skewer',
      link: { targetId: 'abc', filePath: 'index.html', title: 'Skewer' },
    });
    gamePublishActions.choose(artifactId, 'wechat');
    await flushMicrotasks();

    // User hides the right-hand publish panel while continuing in chat.
    gamePublishActions.close(artifactId);
    expect(gamePublishSessionFor(artifactId)?.open).toBe(false);

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const initialMessages: SuperAgentMessage[] = [
      { id: 'm1', role: 'assistant', status: 'completed', text: 'Step 2 of 8 · AppID', createdAt: 1 },
    ];
    try {
      // Mount while panel is closed triggers one sync read; still at appid so no .key button yet.
      wxMock.state.mockResolvedValueOnce(makeWechatStatus('appid'));
      await act(async () => {
        root.render(
          <I18nProvider initialLocale="en">
            <GamePublishThread chatId={chatId} messages={initialMessages} onOpenPanel={vi.fn()} />
            <OpenDesignProgress session={gamePublishSessionFor(artifactId)!} />
          </I18nProvider>,
        );
        await flushMicrotasks();
      });
      expect(host.textContent).not.toContain('Choose the .key file');
      // Right-panel OpenDesignProgress exposes Open & Copy link directly.
      expect(host.querySelector('.om-gp-overview-list a[href="https://play.opendesign.app/g/abc"]')?.textContent).toBe('Open');
      expect(host.querySelector('.om-gp-overview-list button')?.textContent).toBe('Copy link');

      // Agent replies with Step 3 after saving AppID: triggers one-shot refreshWechat and reveals .key picker.
      wxMock.state.mockResolvedValueOnce(makeWechatStatus('key'));
      const step3Messages: SuperAgentMessage[] = [
        ...initialMessages,
        { id: 'm2', role: 'user', text: 'APPID is wxd689822cb07d2570', createdAt: 2 },
        { id: 'm3', role: 'assistant', status: 'completed', text: 'Step 3 of 8 · Upload key', createdAt: 3 },
      ];
      await act(async () => {
        root.render(
          <I18nProvider initialLocale="en">
            <GamePublishThread chatId={chatId} messages={step3Messages} onOpenPanel={vi.fn()} />
          </I18nProvider>,
        );
        await flushMicrotasks();
      });
      expect(host.textContent).toContain('Choose the .key file');
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });

  it('derives turn counts and WeChat inline control visibility from single shared helpers', () => {
    expect(countConversationTurns([])).toBe(0);
    expect(countConversationTurns([
      { id: 'a0', role: 'assistant', status: 'completed', text: 'Welcome', createdAt: 1 },
      { id: 't0', role: 'tool', text: 'check', createdAt: 2 },
    ])).toBe(1);
    expect(countConversationTurns([
      { id: 'a0', role: 'assistant', status: 'completed', text: 'Welcome', createdAt: 1 },
      { id: 'u1', role: 'user', text: 'Hi', createdAt: 2 },
      { id: 't1', role: 'tool', text: 'run', createdAt: 3 },
      { id: 'u2', role: 'user', text: 'Next', createdAt: 4 },
      { id: 'a2', role: 'assistant', status: 'streaming', text: 'Working…', createdAt: 5 },
    ])).toBe(3);

    expect(wechatInlineControlFlags(undefined)).toEqual({ showKey: false, canReplaceKey: false, showQr: false, any: false });
    expect(wechatInlineControlFlags(makeWechatStatus('ip'))).toEqual({ showKey: false, canReplaceKey: false, showQr: false, any: false });
    expect(wechatInlineControlFlags(makeWechatStatus('key'))).toEqual({ showKey: true, canReplaceKey: false, showQr: false, any: true });
    expect(wechatInlineControlFlags(makeWechatStatus('ip', { keyRejected: true }))).toEqual({ showKey: false, canReplaceKey: true, showQr: false, any: true });
    expect(wechatInlineControlFlags(makeWechatStatus('preview', { preview: { createdAt: 'now', qrcodeUrl: '/qr.png' } }))).toEqual({ showKey: false, canReplaceKey: false, showQr: true, any: true });
  });
});
