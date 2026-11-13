import { createApp, watch } from 'vue';
import Dashboard from './components/Dashboard.vue';
import { ACCENT_PALETTE, currentAccent, currentThemeMode, isDarkActive, setThemeMode } from './embedded-theme';
import { setIpcTransport } from './api/ipc';
import { createHumanConsoleTransport } from '../../../../packages/dsh-toolbox-client/src/human-console.js';
import baseStyle from './styles/macos-base.css?inline';
import panelStyle from './styles/panel-cards.css?inline';

export interface EmbeddedConnection {
  rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
  };
}

function embeddedBaseStyle(): string {
  return baseStyle
    .replace(/:root\b/gu, ':host')
    .replace(/html\.dark\b/gu, ':host([data-theme="dark"])')
    .replace(/\[data-theme="dark"\]/gu, ':host([data-theme="dark"])')
    .replace(/\bbody\b/gu, ':host');
}

export function mountEmbeddedDashboard(
  container: HTMLElement,
  connection: EmbeddedConnection,
  componentStyle = '',
): () => void {
  const shadowRoot = container.shadowRoot ?? container.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${embeddedBaseStyle()}\n${panelStyle}\n${componentStyle}\n:host, .embedded-root { display:block; width:100%; height:100%; min-height:0; } .launcher { height:100%; min-height:360px; }`;
  shadowRoot.append(style);

  const mountPoint = document.createElement('div');
  mountPoint.className = 'embedded-root';
  shadowRoot.append(mountPoint);

  const host = container;
  const themeAttribute = host.getAttribute('data-theme');
  const themeVariables = ['--macos-accent', '--macos-accent-rgb', '--macos-accent-subtle', '--macos-border-focus']
    .map(name => [name, host.style.getPropertyValue(name), host.style.getPropertyPriority(name)] as const);
  const syncTheme = () => {
    const dark = currentThemeMode.value === 'dark'
      || (currentThemeMode.value === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const accent = ACCENT_PALETTE.find(color => color.id === currentAccent.value) ?? ACCENT_PALETTE[0];
    isDarkActive.value = dark;
    host.setAttribute('data-theme', dark ? 'dark' : 'light');
    host.style.setProperty('--macos-accent', dark ? accent.darkHex : accent.lightHex);
    host.style.setProperty('--macos-accent-rgb', accent.rgb);
    host.style.setProperty('--macos-accent-subtle', `rgba(${accent.rgb}, ${dark ? 0.18 : 0.10})`);
    host.style.setProperty('--macos-border-focus', `rgba(${accent.rgb}, 0.55)`);
  };
  const restoreHostTheme = () => {
    if (themeAttribute === null) host.removeAttribute('data-theme');
    else host.setAttribute('data-theme', themeAttribute);
    for (const [name, value, priority] of themeVariables) {
      if (value) host.style.setProperty(name, value, priority);
      else host.style.removeProperty(name);
    }
  };
  const stopThemeWatch = watch([currentThemeMode, currentAccent], syncTheme, { flush: 'sync' });
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  systemTheme.addEventListener('change', syncTheme);
  syncTheme();

  let disposed = false;
  const consoleTransport = createHumanConsoleTransport(connection);
  const transport = Object.assign(
    async (cmd: string, args: Record<string, unknown> = {}) => {
      const value = await consoleTransport(cmd, args);
      if (cmd === 'kernel_get_status') {
        const theme = (value as { config?: { general?: { theme?: string } } })?.config?.general?.theme;
        if (theme === 'light' || theme === 'dark' || theme === 'system') setThemeMode(theme);
      }
      return value;
    },
    { dispose: () => consoleTransport.dispose() },
  );
  const restoreTransport = setIpcTransport(transport);
  const app = createApp(Dashboard, { embedded: true });
  let mounted = false;
  try {
    app.mount(mountPoint);
    mounted = true;
  } catch (error) {
    disposed = true;
    if (mounted) app.unmount();
    transport.dispose();
    restoreTransport();
    stopThemeWatch();
    systemTheme.removeEventListener('change', syncTheme);
    restoreHostTheme();
    style.remove();
    mountPoint.remove();
    throw error;
  }
  return () => {
    if (disposed) return;
    disposed = true;
    if (mounted) app.unmount();
    transport.dispose();
    restoreTransport?.();
    stopThemeWatch();
    systemTheme.removeEventListener('change', syncTheme);
    restoreHostTheme();
    style.remove();
    mountPoint.remove();
  };
}
