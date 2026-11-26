/**
 * One shared publish state per game. The right-hand publish panel and the cards in the
 * conversation both read and change this store, so acting in either place updates both.
 * State lives in memory for the session; persisting it is a backend task.
 *
 * Only real work is reported as done: the OpenDesign link (webPublishClient) and packages built
 * in the browser. WeChat Mini Game is guided by the Agent via openmotion_game_wechat; all other
 * platforms advance instantaneously through local inline step controls and record completion locally.
 */
import { useSyncExternalStore } from 'react';
import { buildPlatformZip, buildPlayable, gameSlug, loadGameHtml, type GamePackageResult, type GamePackageTarget } from './gamePackage';
import { describeLinkError, publishGameLink, type GamePublishLinkTarget } from './gamePublishAdapter';
import type { GamePublishDevToolId } from './devTools';
import { gamePublishPlatform, storeLinkProblem, type GamePublishPlatform, type GamePublishPlatformId, type GamePublishStep } from './platforms';
import { queueSuperAgentHandoff } from '../../motion/superAgentHandoff';
import { wechatClient, type WechatPublishStatus } from './wechatClient';
import wechatPortGuide from '../../../../skills/openmotion-game/references/wechat-minigame-port.md?raw';

export type GamePublishView = 'list' | 'step' | 'result';

export interface GamePublishStatus {
  tone: 'idle' | 'running' | 'done' | 'error';
  /** English source key; `vars` values are substituted as-is. */
  key: string;
  vars?: Record<string, string | number>;
}

export interface GamePublishPackageState {
  state: 'building' | 'ready' | 'failed';
  target: GamePackageTarget;
  result?: GamePackageResult;
  error?: string;
}

/** WeChat Mini Game state, shared by the panel and the conversation cards. */
export interface GamePublishWechatState {
  /** What the local service last reported. The Agent's openmotion_game_wechat calls update the same record, so the panel never guesses. */
  status?: WechatPublishStatus;
  /** Could not read the progress (OpenDesign not running on this computer, …). */
  error?: string;
  keySaving?: boolean;
  keyError?: string;
}

export interface GamePublishSession {
  artifactId: string;
  chatId: string | null;
  gameId: string;
  gameTitle: string;
  orientation?: 'portrait' | 'landscape';
  /** Share target for the OpenDesign link; missing when the game cannot be shared. */
  link?: GamePublishLinkTarget;
  open: boolean;
  view: GamePublishView;
  platformId?: GamePublishPlatformId;
  stepIndex: number;
  picked?: string;
  inputs: Record<string, string>;
  /** Why the current step cannot continue yet (English source key). */
  stepProblem?: string;
  status: GamePublishStatus;
  linkUrl?: string;
  linkPublishing: boolean;
  /** OpenDesign is selected by default: picking a platform also publishes the OpenDesign play link. */
  linkToo: boolean;
  /** True when a platform was picked while account state was still loading, so link publish waits until resolved. */
  linkDeferred?: boolean;
  linkError?: { message: string; authRequired: boolean };
  published: GamePublishPlatformId[];
  /** Developer tool the user must confirm before the platform steps. */
  toolCheck?: { toolId: GamePublishDevToolId; state: 'checking' | 'missing' | 'ok'; path?: string };
  package?: GamePublishPackageState;
  wechat?: GamePublishWechatState;
}

export type GamePublishWorkKind = 'link' | 'package' | 'wechat-key';

export type GamePublishThreadEntry =
  | { id: string; artifactId: string; kind: 'user'; key: string; name?: string }
  | { id: string; artifactId: string; kind: 'agent'; work: GamePublishWorkKind; title: string; name?: string; lines: Array<{ text: string; vars?: Record<string, string | number>; done: boolean }>; failed?: boolean; packageResult?: GamePackageResult }
  | { id: string; artifactId: string; kind: 'result'; title: string; detail: string; vars?: Record<string, string>; action?: string; href?: string; link?: boolean }
  | { id: string; artifactId: string; kind: 'link-failed'; message: string; authRequired: boolean }
  ;

const sessions = new Map<string, GamePublishSession>();
const threads = new Map<string, GamePublishThreadEntry[]>();
const listeners = new Set<() => void>();
/** Bumped whenever the user picks a platform, so work started for an earlier choice cannot touch the current one. */
const platformRuns = new Map<string, number>();
let entrySeq = 0;

function emit() { for (const listener of listeners) listener(); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

function update(artifactId: string, patch: Partial<GamePublishSession>) {
  const current = sessions.get(artifactId);
  if (!current) return;
  sessions.set(artifactId, { ...current, ...patch });
  emit();
}

function threadKey(session: GamePublishSession) { return session.chatId ?? `artifact:${session.artifactId}`; }

type NewThreadEntry = GamePublishThreadEntry extends infer E ? E extends GamePublishThreadEntry ? Omit<E, 'id' | 'artifactId'> : never : never;

function pushEntry(session: GamePublishSession, entry: NewThreadEntry): string {
  const key = threadKey(session);
  const id = `publish-${++entrySeq}`;
  threads.set(key, [...(threads.get(key) ?? []), { ...entry, id, artifactId: session.artifactId } as GamePublishThreadEntry]);
  emit();
  return id;
}

function patchEntries(session: GamePublishSession, patch: (entry: GamePublishThreadEntry) => GamePublishThreadEntry) {
  const key = threadKey(session);
  threads.set(key, (threads.get(key) ?? []).map(entry => (entry.artifactId === session.artifactId ? patch(entry) : entry)));
  emit();
}

function removeEntries(session: GamePublishSession, predicate: (entry: GamePublishThreadEntry) => boolean) {
  const key = threadKey(session);
  const current = threads.get(key);
  if (!current?.length) return;
  const next = current.filter(entry => !(entry.artifactId === session.artifactId && predicate(entry)));
  if (next.length !== current.length) {
    threads.set(key, next);
    emit();
  }
}

function isLinkFailureEntry(entry: GamePublishThreadEntry) {
  return entry.kind === 'link-failed' || (entry.kind === 'agent' && entry.work === 'link' && Boolean(entry.failed));
}

function isPackageWorkEntry(entry: GamePublishThreadEntry) {
  return entry.kind === 'agent' && entry.work === 'package';
}

/** A conversation block for real work; lines are added as each part actually finishes. */
function startWork(artifactId: string, work: GamePublishWorkKind, title: string, name?: string) {
  const session = sessions.get(artifactId)!;
  const id = pushEntry(session, { kind: 'agent', work, title, name, lines: [] });
  const edit = (change: (entry: Extract<GamePublishThreadEntry, { kind: 'agent' }>) => Extract<GamePublishThreadEntry, { kind: 'agent' }>) => {
    const latest = sessions.get(artifactId);
    if (latest) patchEntries(latest, entry => (entry.id === id && entry.kind === 'agent' ? change(entry) : entry));
  };
  return {
    line(text: string, vars?: Record<string, string | number>) { edit(entry => ({ ...entry, lines: [...entry.lines, { text, vars, done: true }] })); },
    fail(text: string, vars?: Record<string, string | number>) { edit(entry => ({ ...entry, failed: true, lines: [...entry.lines, { text, vars, done: false }] })); },
    attachPackage(result: GamePackageResult) { edit(entry => ({ ...entry, packageResult: result })); },
  };
}

function stepInProgress(session: GamePublishSession): boolean {
  const platform = gamePublishPlatform(session.platformId);
  return Boolean(platform && session.stepIndex < platform.steps.length);
}

function toolReady(session: GamePublishSession) { return !session.toolCheck || session.toolCheck.state === 'ok'; }

/** Whether the current step's main button is disabled (shared by the conversation card and the panel). */
export function stepBlocked(session: GamePublishSession, step: GamePublishStep): boolean {
  return session.toolCheck?.state === 'missing'
    || (step.kind === 'package' && session.package?.state !== 'ready')
    || (step.kind === 'link' && !session.linkUrl);
}

/** Controls under an Agent message only act on the platform and step they were shown for. */
export interface GamePublishStepRef { platformId: GamePublishPlatformId; stepIndex: number }
function matchesStep(session: GamePublishSession, ref: GamePublishStepRef) {
  return session.platformId === ref.platformId && session.stepIndex === ref.stepIndex && stepInProgress(session) && toolReady(session);
}

const WAITING: GamePublishStatus = { tone: 'idle', key: 'Waiting for you' };

function patchWechat(artifactId: string, patch: Partial<GamePublishWechatState>) {
  const session = sessions.get(artifactId);
  if (!session?.wechat) return;
  update(artifactId, { wechat: { ...session.wechat, ...patch } });
}

/** Progress polling per artifact while the WeChat panel is open. */
const wechatPolls = new Map<string, ReturnType<typeof setInterval>>();
function stopWechatPoll(artifactId: string) {
  const timer = wechatPolls.get(artifactId);
  if (timer) clearInterval(timer);
  wechatPolls.delete(artifactId);
}
const WECHAT_POLL_MS = 2500;

/** What the Agent is told, out of sight, when the user picks WeChat: the publish guide and this game. */
function wechatInstructions(session: GamePublishSession) {
  return `${wechatPortGuide}\n\nGame id: ${session.gameId}. Guide the user through publishing this game as a WeChat Mini Game, one step per message, starting with openmotion_game_wechat action "status". The panel on the right shows the same steps from that status; it has no instructions of its own.${linkNote(session)}`;
}

/** Tells the Agent about the OpenDesign link when the user kept OpenDesign selected; the page publishes it. */
export function linkNote(session: GamePublishSession) {
  if (!session.linkToo && !session.linkUrl) return '';
  // Only claim "published" once the link is live; while it is still publishing (or failed) say what the page shows.
  const line = session.linkUrl
    ? '"OpenDesign 试玩链接已发布，可以在下面点打开或复制" (English: "The OpenDesign play link is published; open or copy it below")'
    : '"OpenDesign 试玩链接正在发布，好了会在下面显示打开和复制" (English: "The OpenDesign play link is being published; Open and Copy link appear below when it is ready")';
  return `\n\nThe user kept OpenDesign selected. In your first message say only, in the user's language: ${line}. Never write the link or any URL to it, never say who published it or that you will not change it, and do not publish it yourself.`;
}

/** Makes step `index` current, builds its package if it has one. */
function enterStep(artifactId: string, platform: GamePublishPlatform, index: number) {
  update(artifactId, { stepIndex: index, view: 'step', stepProblem: undefined, status: WAITING });
  const step = platform.steps[index];
  if (step.kind === 'package' && step.packageTarget) void gamePublishActions.buildPackage(artifactId);
}

export interface GamePublishOpenInput { artifactId: string; chatId: string | null; gameId: string; gameTitle: string; orientation?: 'portrait' | 'landscape'; link?: GamePublishLinkTarget }

export const gamePublishActions = {
  open(input: GamePublishOpenInput) {
    const existing = sessions.get(input.artifactId);
    if (existing) {
      // A checkpoint result (steps still to go) stays; a final result goes back to the list.
      const view: GamePublishView = existing.view === 'result' && !stepInProgress(existing) ? 'list' : existing.view === 'list' && stepInProgress(existing) ? 'step' : existing.view;
      update(input.artifactId, { open: true, view: existing.platformId === 'wechat' && view !== 'list' ? 'step' : view, chatId: input.chatId ?? existing.chatId, link: input.link ?? existing.link });
      if (existing.platformId === 'wechat' && existing.wechat) gamePublishActions.watchWechat(input.artifactId);
      return;
    }
    sessions.set(input.artifactId, {
      ...input,
      open: true,
      view: 'list',
      stepIndex: 0,
      inputs: {},
      status: WAITING,
      linkPublishing: false,
      linkToo: true,
      published: [],
    });
    emit();
  },
  close(artifactId: string) { update(artifactId, { open: false }); },
  /** Show the panel again for a game that already has publish state (e.g. from a conversation card). */
  reopen(artifactId: string) {
    const session = sessions.get(artifactId);
    if (session) gamePublishActions.open({ ...session, artifactId });
  },
  toggle(input: GamePublishOpenInput) {
    if (sessions.get(input.artifactId)?.open) gamePublishActions.close(input.artifactId);
    else gamePublishActions.open(input);
  },
  showList(artifactId: string) { update(artifactId, { view: 'list' }); },
  /** The OpenDesign choice at the top of the platform list (selected by default). */
  setLinkToo(artifactId: string, on: boolean) { update(artifactId, { linkToo: on, linkDeferred: false }); },
  /** Resolves a deferred OpenDesign link decision once the account summary resolves or fails. */
  resolveDeferredLink(artifactId: string, signedIn: boolean) {
    const session = sessions.get(artifactId);
    if (!session?.linkDeferred) return;
    if (signedIn) {
      update(artifactId, { linkDeferred: false });
      const latest = sessions.get(artifactId)!;
      if (latest.linkToo && !latest.linkUrl && !latest.linkPublishing && !latest.linkError) {
        void gamePublishActions.publishLink(artifactId);
      }
      return;
    }
    update(artifactId, {
      linkDeferred: false,
      ...(session.platformId && session.platformId !== 'telegram' ? { linkToo: false, linkError: undefined } : {}),
    });
  },
  /** Clears an OpenDesign link failure and continues with the chosen platform only. */
  dismissLinkError(artifactId: string) {
    const session = sessions.get(artifactId);
    if (!session) return;
    removeEntries(session, isLinkFailureEntry);
    update(artifactId, { linkToo: false, linkDeferred: false, linkError: undefined });
  },
  /** Publishes the game on OpenDesign Cloud, the same way the toolbar Share button does. */
  async publishLink(artifactId: string): Promise<void> {
    const session = sessions.get(artifactId);
    if (!session || session.linkPublishing) return;
    removeEntries(session, isLinkFailureEntry);
    if (!session.link) {
      const linkError = { message: 'This game cannot get a share link yet', authRequired: false };
      update(artifactId, { linkError, linkDeferred: false });
      pushEntry(sessions.get(artifactId)!, { kind: 'link-failed', message: linkError.message, authRequired: false });
      return;
    }
    update(artifactId, { linkPublishing: true, linkDeferred: false, linkError: undefined });
    const work = startWork(artifactId, 'link', 'Publishing on OpenDesign');
    try {
      const { url } = await publishGameLink(session.link);
      work.line('The game link is published');
      update(artifactId, { linkUrl: url, linkPublishing: false });
      pushEntry(sessions.get(artifactId)!, { kind: 'result', title: 'Live on OpenDesign', detail: url, link: true });
    } catch (error) {
      const linkError = describeLinkError(error);
      if (linkError.authRequired) {
        // Keep the thread clean: the link-failed card renders the localized sign-in action without raw English error logs.
        const latest = sessions.get(artifactId);
        if (latest) removeEntries(latest, entry => entry.kind === 'agent' && entry.work === 'link' && !entry.lines.length);
      } else {
        work.fail('Publishing failed: {message}', { message: linkError.message });
      }
      update(artifactId, { linkPublishing: false, linkError });
      pushEntry(sessions.get(artifactId)!, { kind: 'link-failed', message: linkError.message, authRequired: linkError.authRequired });
    }
  },
  choose(artifactId: string, platformId: GamePublishPlatformId, options?: { signedIn?: boolean; deferLink?: boolean }) {
    const session = sessions.get(artifactId);
    const platform = gamePublishPlatform(platformId);
    if (!session || !platform) return;
    platformRuns.set(artifactId, (platformRuns.get(artifactId) ?? 0) + 1);
    const guestOnNonLinkPlatform = options?.signedIn === false && platformId !== 'telegram';
    const guestOnTelegram = options?.signedIn === false && platformId === 'telegram';
    // Clear stale link errors and previous package build logs so re-picking a platform never stacks duplicate cards.
    removeEntries(session, entry => isLinkFailureEntry(entry) || isPackageWorkEntry(entry));
    update(artifactId, {
      platformId,
      stepIndex: 0,
      picked: undefined,
      inputs: {},
      view: 'step',
      stepProblem: undefined,
      toolCheck: undefined,
      package: undefined,
      status: WAITING,
      linkDeferred: Boolean(options?.deferLink),
      ...(guestOnNonLinkPlatform ? { linkToo: false, linkError: undefined } : {}),
      ...(guestOnTelegram ? { linkError: undefined } : {}),
    });
    const latest = sessions.get(artifactId)!;
    // OpenDesign is selected by default when signed in; guests on non-Telegram platforms proceed without a blocking auth error,
    // guests on Telegram sign in directly inside Step 1 (LinkStep), and unknown account states defer until resolved.
    if (latest.linkToo && !latest.linkUrl && !latest.linkPublishing && options?.signedIn !== false && !options?.deferLink) {
      void gamePublishActions.publishLink(artifactId);
    }
    if (platform.id === 'wechat') {
      gamePublishActions.startWechat(artifactId);
      return;
    }
    // Non-WeChat platforms are driven instantaneously by local step controls and package builders,
    // without queuing redundant Codex turns that stream out of order above the interactive cards.
    if (platform.devTool) {
      update(artifactId, { toolCheck: { toolId: platform.devTool, state: 'missing' } });
      return;
    }
    enterStep(artifactId, platform, 0);
  },
  /** The user says the developer tool is installed. OpenDesign does not check the machine yet. */
  confirmDevTool(artifactId: string) {
    const session = sessions.get(artifactId);
    const platform = gamePublishPlatform(session?.platformId);
    if (!session || !platform || session.toolCheck?.state !== 'missing') return;
    // WeChat does not wait for the tool: keep the current step.
    if (platform.id === 'wechat') { gamePublishActions.dismissDevTool(artifactId); return; }
    const { toolId } = session.toolCheck;
    update(artifactId, { toolCheck: { toolId, state: 'ok' } });
    enterStep(artifactId, platform, 0);
  },
  /** "Later": leave this platform and go back to the list. */
  skipDevTool(artifactId: string) {
    const session = sessions.get(artifactId);
    if (!session || session.toolCheck?.state !== 'missing') return;
    platformRuns.set(artifactId, (platformRuns.get(artifactId) ?? 0) + 1);
    update(artifactId, { view: 'list', platformId: undefined, toolCheck: undefined, stepIndex: 0, status: WAITING });
  },
  pick(artifactId: string, option: string) { update(artifactId, { picked: option, stepProblem: undefined }); },
  setInput(artifactId: string, label: string, value: string) {
    const session = sessions.get(artifactId);
    if (session) update(artifactId, { inputs: { ...session.inputs, [label]: value }, stepProblem: undefined });
  },
  /** Builds the current step's package from the game's real files. */
  async buildPackage(artifactId: string): Promise<void> {
    const session = sessions.get(artifactId);
    const platform = gamePublishPlatform(session?.platformId);
    const step = platform?.steps[session?.stepIndex ?? 0];
    if (!session || !platform || !step?.packageTarget || session.package?.state === 'building') return;
    const target = step.packageTarget;
    const run = platformRuns.get(artifactId);
    const isCurrent = () => platformRuns.get(artifactId) === run;
    update(artifactId, { package: { state: 'building', target }, status: { tone: 'running', key: 'Building the package' } });
    const work = startWork(artifactId, 'package', 'Building the {name} package', target === 'playable' ? session.picked ?? platform.name : platform.name);
    try {
      const loaded = await loadGameHtml(session.gameId);
      work.line(loaded.missing.length ? 'Read the game; {count} local file(s) could not be read' : 'Read the game and inlined {count} local file(s)', { count: loaded.missing.length || loaded.inlined });
      const slug = gameSlug(session.gameTitle, session.gameId);
      const result = target === 'playable'
        ? buildPlayable(loaded, {
          networkName: session.picked ?? '',
          slug,
          ios: session.inputs['iOS App Store link']?.trim(),
          android: session.inputs['Google Play link']?.trim(),
          orientation: session.orientation,
          buttonText: 'Download',
        })
        : buildPlatformZip(loaded, target, slug);
      if (!isCurrent()) return;
      work.line('Built {file}', { file: result.fileName });
      work.attachPackage(result);
      const failed = result.checks.filter(check => check.tone === 'fail').length;
      if (failed) work.fail('{count} check(s) failed; see the panel', { count: failed });
      update(artifactId, { package: { state: 'ready', target, result }, status: failed ? { tone: 'error', key: '{count} check(s) failed', vars: { count: failed } } : WAITING });
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : String(error);
      work.fail('Could not build the package: {message}', { message });
      update(artifactId, { package: { state: 'failed', target, error: message }, status: { tone: 'error', key: 'Could not build the package' } });
    }
  },
  /**
   * WeChat: the Agent guides the user in this conversation, one step per message. The panel only shows progress,
   * read from the same record the Agent's tool calls write.
   */
  startWechat(artifactId: string) {
    const session = sessions.get(artifactId);
    if (!session) return;
    update(artifactId, { wechat: { status: session.wechat?.status }, status: { tone: 'running', key: 'The Agent is guiding you in the conversation' } });
    queueSuperAgentHandoff({
      prompt: `把「${session.gameTitle}」上架到微信小游戏`,
      hiddenInstructions: wechatInstructions(session),
      mode: 'game',
      newChat: false,
      autoSend: true,
    });
    gamePublishActions.watchWechat(artifactId);
  },
  /** Reads the progress now and every few seconds while the WeChat panel is open. */
  watchWechat(artifactId: string) {
    stopWechatPoll(artifactId);
    void gamePublishActions.refreshWechat(artifactId);
    wechatPolls.set(artifactId, setInterval(() => {
      const session = sessions.get(artifactId);
      if (!session || session.platformId !== 'wechat' || !session.open) { stopWechatPoll(artifactId); return; }
      void gamePublishActions.refreshWechat(artifactId);
    }, WECHAT_POLL_MS));
  },
  async refreshWechat(artifactId: string): Promise<void> {
    const session = sessions.get(artifactId);
    if (!session) return;
    const run = platformRuns.get(artifactId);
    try {
      const status = await wechatClient.state(session.gameId);
      if (platformRuns.get(artifactId) !== run || sessions.get(artifactId)?.platformId !== 'wechat') return;
      patchWechat(artifactId, { status, error: undefined });
      const done = status.steps.filter(step => !step.later).every(step => step.status === 'done');
      update(artifactId, { status: done ? { tone: 'done', key: 'Testers can play it now' } : status.current === 'port' ? { tone: 'running', key: 'The Agent is porting the game' } : WAITING });
    } catch (error) {
      if (platformRuns.get(artifactId) !== run) return;
      patchWechat(artifactId, { error: error instanceof Error ? error.message : String(error) });
    }
  },
  /** Sends the .key file to the local service; the text is not kept in the page and never enters the conversation. */
  async saveWechatKey(artifactId: string, privateKey: string): Promise<void> {
    const session = sessions.get(artifactId);
    const appid = session?.wechat?.status?.appid;
    if (!session?.wechat || session.wechat.keySaving || !appid) return;
    patchWechat(artifactId, { keySaving: true, keyError: undefined });
    try {
      await wechatClient.saveKey(appid, privateKey);
      patchWechat(artifactId, { keySaving: false });
      // Only this line goes into the conversation; the key itself never does (and never reaches the Agent).
      startWork(artifactId, 'wechat-key', 'Saved the upload key').line('Saved on this computer for {appid}; the conversation keeps no copy', { appid });
      await gamePublishActions.refreshWechat(artifactId);
    } catch (error) {
      patchWechat(artifactId, { keySaving: false, keyError: error instanceof Error ? error.message : String(error) });
    }
  },
  /** Closes the "DevTools not installed" notice; publishing continues without it. */
  dismissDevTool(artifactId: string) {
    const session = sessions.get(artifactId);
    if (!session || session.toolCheck?.state !== 'missing') return;
    update(artifactId, { toolCheck: { ...session.toolCheck, state: 'ok' } });
  },
  /** The user finished the current step (from the panel or the conversation card). */
  completeStep(artifactId: string, from?: GamePublishStepRef) {
    const session = sessions.get(artifactId);
    if (!session || session.view === 'result' || (from && !matchesStep(session, from))) return;
    const platform = gamePublishPlatform(session.platformId);
    if (!platform || !stepInProgress(session) || !toolReady(session)) return;
    const step = platform.steps[session.stepIndex];
    const problem = step.pick && !session.picked
      ? 'Choose one first.'
      : step.fields ? storeLinkProblem(session.inputs)
        : step.kind === 'package' && session.package?.state !== 'ready' ? 'The package is not ready yet.'
          : step.kind === 'link' && !session.linkUrl ? 'Publish the OpenDesign link first.'
            : undefined;
    if (problem) { update(artifactId, { open: true, view: 'step', stepProblem: problem }); return; }
    const next = session.stepIndex + 1;
    if (next < platform.steps.length) {
      enterStep(artifactId, platform, next);
      return;
    }
    const latest = sessions.get(artifactId)!;
    update(artifactId, {
      stepIndex: platform.steps.length,
      view: 'result',
      published: latest.published.includes(platform.id) ? latest.published : [...latest.published, platform.id],
      status: { tone: 'done', key: 'Recorded what you did' },
    });
    pushEntry(sessions.get(artifactId)!, {
      kind: 'result',
      title: platform.resultTitle,
      detail: platform.resultDetail,
      action: platform.resultAction,
      href: platform.resultHref,
    });
  },
};

/** The publish run of this conversation, if any: its step controls live under the Agent's messages. */
export function usePublishForChat(chatId: string | null | undefined): GamePublishSession | undefined {
  return useSyncExternalStore(subscribe, () => {
    if (!chatId) return undefined;
    for (const session of sessions.values()) {
      if (session.chatId !== chatId || !session.platformId) continue;
      if (session.platformId === 'wechat' ? session.wechat : session.view === 'step') return session;
    }
    return undefined;
  });
}

export function useGamePublishSession(artifactId: string | null | undefined): GamePublishSession | undefined {
  return useSyncExternalStore(subscribe, () => (artifactId ? sessions.get(artifactId) : undefined));
}

const EMPTY: GamePublishThreadEntry[] = [];
export function useGamePublishThread(chatId: string | null | undefined): GamePublishThreadEntry[] {
  return useSyncExternalStore(subscribe, () => (chatId ? threads.get(chatId) ?? EMPTY : EMPTY));
}

export function gamePublishSessionFor(artifactId: string): GamePublishSession | undefined { return sessions.get(artifactId); }
export function gamePublishThreadFor(chatId: string): GamePublishThreadEntry[] { return threads.get(chatId) ?? EMPTY; }

/** Test helper. */
export function resetGamePublishStore() { for (const key of [...wechatPolls.keys()]) stopWechatPoll(key); sessions.clear(); threads.clear(); platformRuns.clear(); entrySeq = 0; emit(); }

/** Copies the published link and reports the real outcome. */
export async function copyGamePublishLink(url: string | undefined, notify: ((message: string, tone?: 'info' | 'error') => void) | undefined, t: (key: string) => string) {
  if (!url) return;
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    await navigator.clipboard.writeText(full);
    notify?.(t('Link copied'));
  } catch {
    notify?.(t('Could not copy the link'), 'error');
  }
}
