// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import readme from '../../../README.md?raw';
import chineseReadme from '../../../README.zh-CN.md?raw';
import { I18nProvider } from '../i18n/I18n';
import {
  savedAutoMultimodalGeneration,
  savedFollowUpBehavior,
  setCachedAutoMultimodalGeneration,
  setFollowUpBehavior,
} from '../utils/superAgentPreferences';
import { SettingsCenter } from './SettingsCenter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('hf-studio-ui-preferences');
  setFollowUpBehavior('steer');
  setCachedAutoMultimodalGeneration(true);
});

it.each([
  { locale: 'zh-CN', heading: '社群', labels: ['飞书群', 'Discord'], document: chineseReadme },
  { locale: 'en', heading: 'Community', labels: ['Discord', 'Feishu group'], document: readme },
] as const)('offers both README invitations in locale order from Help in $locale', ({ locale, heading, labels, document }) => {
  const html = renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <SettingsCenter section="help" onSection={() => {}} openConnections={() => {}} />
    </I18nProvider>,
  );
  const page = new DOMParser().parseFromString(html, 'text/html');
  const section = page.querySelector('section[aria-labelledby="om-community-heading"]');
  expect(section?.querySelector('h2')?.textContent).toBe(heading);
  const links = Array.from(section!.querySelectorAll('a'));
  expect(links.map(link => link.textContent)).toEqual(labels);
  for (const link of links) {
    expect(document).toContain(`href="${link.href}"`);
    expect(link.target).toBe('_blank');
    expect(link.relList.contains('noopener')).toBe(true);
  }
});

it('renders Follow-up behavior in General settings defaulting to Steer and persists Queue changes', async () => {
  localStorage.removeItem('hf-studio-ui-preferences');
  expect(savedFollowUpBehavior()).toBe('steer');

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <SettingsCenter section="general" onSection={() => {}} openConnections={() => {}} />
        </I18nProvider>,
      );
    });

    expect(container.textContent).toContain('Follow-ups');
    const trigger = container.querySelector<HTMLElement>('[role="combobox"][aria-label="Follow-up behavior"]')!;
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain('Steer');

    await act(async () => trigger.click());
    const queueOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      el => el.textContent?.includes('Queue'),
    )!;
    expect(queueOption).toBeTruthy();
    await act(async () => queueOption.click());

    expect(savedFollowUpBehavior()).toBe('queue');
    expect(trigger.textContent).toContain('Queue');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it('renders Auto-generate multimodal assets toggle in General settings defaulting to ON and syncs updates with backend', async () => {
  localStorage.removeItem('hf-studio-ui-preferences');
  expect(savedAutoMultimodalGeneration()).toBe(true);

  let serverEnabled = true;
  let failNextPatch = false;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/motion-api/super-agent/preferences')) {
      if (init?.method === 'PATCH') {
        if (failNextPatch) {
          return new Response(JSON.stringify({ error: 'Disk full' }), { status: 500 });
        }
        const body = JSON.parse(String(init.body ?? '{}')) as { autoMultimodalGeneration?: boolean };
        serverEnabled = Boolean(body.autoMultimodalGeneration);
        return new Response(JSON.stringify({ preferences: { autoMultimodalGeneration: serverEnabled } }), { status: 200 });
      }
      return new Response(JSON.stringify({ preferences: { autoMultimodalGeneration: serverEnabled } }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="zh-CN">
          <SettingsCenter section="general" onSection={() => {}} openConnections={() => {}} />
        </I18nProvider>,
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="自动生成多模态素材"]')!;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    // Turn OFF -> persists to backend
    await act(async () => {
      toggle.click();
    });
    expect(serverEnabled).toBe(false);
    expect(savedAutoMultimodalGeneration()).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    // Failed PATCH -> reverts switch cleanly
    failNextPatch = true;
    await act(async () => {
      toggle.click();
    });
    expect(savedAutoMultimodalGeneration()).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/motion-api/super-agent/preferences',
      expect.objectContaining({ method: 'PATCH' }),
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it('ignores a slow mount GET response that arrives after the user toggles Auto-generate multimodal assets', async () => {
  localStorage.removeItem('hf-studio-ui-preferences');
  expect(savedAutoMultimodalGeneration()).toBe(true);

  let resolveSlowGet!: (res: Response) => void;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/motion-api/super-agent/preferences')) {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body ?? '{}')) as { autoMultimodalGeneration?: boolean };
        return Promise.resolve(new Response(JSON.stringify({ preferences: { autoMultimodalGeneration: Boolean(body.autoMultimodalGeneration) } }), { status: 200 }));
      }
      return new Promise<Response>(resolve => {
        resolveSlowGet = resolve;
      });
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="zh-CN">
          <SettingsCenter section="general" onSection={() => {}} openConnections={() => {}} />
        </I18nProvider>,
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="自动生成多模态素材"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    // User toggles OFF while the initial mount GET is still in flight
    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(savedAutoMultimodalGeneration()).toBe(false);

    // Stale mount GET finally resolves with the old `true` value -> must be ignored
    await act(async () => {
      resolveSlowGet(new Response(JSON.stringify({ preferences: { autoMultimodalGeneration: true } }), { status: 200 }));
      await Promise.resolve();
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(savedAutoMultimodalGeneration()).toBe(false);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
