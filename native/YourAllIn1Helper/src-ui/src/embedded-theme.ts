import { ref } from 'vue';

export type ThemeMode = 'light' | 'dark' | 'system';
export type AccentColor = 'blue' | 'purple' | 'pink' | 'orange' | 'green' | 'graphite';

export interface AccentColorSpec {
  id: AccentColor;
  name: string;
  lightHex: string;
  darkHex: string;
  rgb: string;
}

export const ACCENT_PALETTE: AccentColorSpec[] = [
  { id: 'blue', name: '经典蓝', lightHex: '#007aff', darkHex: '#0a84ff', rgb: '0, 122, 255' },
  { id: 'purple', name: '罗兰紫', lightHex: '#af52de', darkHex: '#bf5af2', rgb: '175, 82, 222' },
  { id: 'pink', name: '亮粉红', lightHex: '#ff2d55', darkHex: '#ff375f', rgb: '255, 45, 85' },
  { id: 'orange', name: '暖夕橙', lightHex: '#ff9500', darkHex: '#ff9f0a', rgb: '255, 149, 0' },
  { id: 'green', name: '薄荷绿', lightHex: '#34c759', darkHex: '#30d158', rgb: '52, 199, 89' },
  { id: 'graphite', name: '石墨灰', lightHex: '#8e8e93', darkHex: '#98989d', rgb: '142, 142, 147' },
];

const STORAGE_KEY_MODE = 'macos_theme_mode';
const STORAGE_KEY_ACCENT = 'macos_theme_accent';
const validModes = new Set<ThemeMode>(['light', 'dark', 'system']);
const validAccents = new Set<AccentColor>(ACCENT_PALETTE.map(color => color.id));

function storedValue<T extends string>(key: string, allowed: Set<T>, fallback: T): T {
  const value = window.localStorage.getItem(key);
  return value !== null && allowed.has(value as T) ? value as T : fallback;
}

export const currentThemeMode = ref<ThemeMode>(storedValue(STORAGE_KEY_MODE, validModes, 'light'));
export const currentAccent = ref<AccentColor>(storedValue(STORAGE_KEY_ACCENT, validAccents, 'blue'));
export const isDarkActive = ref(false);

export function setThemeMode(mode: ThemeMode): void {
  currentThemeMode.value = mode;
  window.localStorage.setItem(STORAGE_KEY_MODE, mode);
}

export function setAccentColor(accent: AccentColor): void {
  currentAccent.value = accent;
  window.localStorage.setItem(STORAGE_KEY_ACCENT, accent);
}
