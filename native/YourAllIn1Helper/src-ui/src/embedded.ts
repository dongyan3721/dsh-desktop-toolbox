import { createApp, watch } from 'vue';
import Dashboard from './components/Dashboard.vue';
import { ACCENT_PALETTE, currentAccent, currentThemeMode, isDarkActive, setThemeMode } from './embedded-theme';
import { setIpcTransport } from './api/ipc';
import { setLocaleTarget } from './utils/i18n';
import { createHumanConsoleTransport } from '../../../../packages/dsh-toolbox-client/src/human-console.js';
import baseStyle from './styles/macos-base.css?inline';
import panelStyle from './styles/panel-cards.css?inline';

export interface EmbeddedConnection {
  rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
  };
}

function embeddedBaseStyle(): string {
  return baseStyle.replace(/html\.dark\b|\[data-theme="dark"\]|:root\b|\bbody\b/gu,
    selector => selector === ':root' || selector === 'body' ? ':host' : ':host([data-theme="dark"])');
}

export function mountEmbeddedDashboard(
  container: HTMLElement,
  connection: EmbeddedConnection,
  componentStyle = '',
): () => void {
  const shadowRoot = container.shadowRoot ?? container.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${embeddedBaseStyle()}\n${panelStyle}\n${componentStyle}\n
    :host, .embedded-root { display:block; width:100%; height:100%; min-width:0; min-height:0; }
    .embedded-root { container-type:inline-size; }
    .launcher.macos-window { width:100%; height:100%; min-width:0; min-height:0; }
    .embedded-root .feature-grid { grid-template-columns:repeat(auto-fit, minmax(min(360px, 100%), 1fr)); }
    @container (max-width:580px) {
      .embedded-root .shortcut-row { grid-template-columns:1fr; padding:8px 0; }
      .embedded-root .shortcut-controls { justify-content:space-between; }
      .embedded-root .shortcut-input { flex:1; min-width:0; }
    }`;
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
  const restoreLocaleTarget = setLocaleTarget(container);
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
    restoreLocaleTarget();
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
    restoreLocaleTarget();
    stopThemeWatch();
    systemTheme.removeEventListener('change', syncTheme);
    restoreHostTheme();
    style.remove();
    mountPoint.remove();
  };
}
