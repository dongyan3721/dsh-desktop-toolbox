<template>
  <div>
    <p v-if="error" class="module-error" role="alert">{{ error }}</p>
    <div class="feature-grid">
      <article
        v-for="module in displayModules"
        :key="module.id"
        class="feature-row"
        :class="{ inactive: !module.enabled }"
      >
        <div class="feature-icon">
          <Icons :name="FEATURES.find((f) => f.module === module.id)?.icon || 'dashboard'" :size="20" />
        </div>
        <div class="feature-info">
          <div class="feature-title-bar">
            <h3>{{ formatModuleName(module) }}</h3>
            <button
              class="open-link"
              :aria-label="t('desktop.openFeature', { name: formatModuleName(module) })"
              :disabled="!module.enabled || !module.available || !module.supported || opening != null || pendingHuman !== null"
              :title="module.enabled ? '' : t('desktop.enableFirst')"
              @click="emit('open', module.id)"
            >
              {{ opening === module.id ? t('desktop.opening') : t('desktop.openPanel') }} <span aria-hidden="true">↗</span>
            </button>
          </div>

          <!-- 仅在支持 Agent 的模块展示共享范围及未启用提示 -->
          <div v-if="isAgentSupported(module)" class="agent-scope-container">
            <p class="scope-text">{{ getAgentScopeText(module.id) }}</p>
            <p
              v-if="module.agent_allowed && !module.enabled"
              class="ineffective-hint"
              role="note"
            >
              {{ t('moduleManager.agentIneffectiveNotice') }}
            </p>
          </div>
        </div>

        <div class="feature-controls">
          <!-- 开关 1：开启功能（人用启用状态） -->
          <div class="control-row">
            <span class="control-label">{{ t('moduleManager.enableFeature') }}</span>
            <button
              class="feature-switch"
              :class="{ enabled: module.enabled }"
              role="switch"
              :aria-checked="module.enabled"
              :aria-label="t('moduleManager.switchAria', { name: formatModuleName(module) })"
              :title="formatModuleStatus(module)"
              :disabled="!module.available || !module.supported || pendingHuman === module.id"
              :aria-busy="pendingHuman === module.id"
              @click="toggleEnabled(module)"
            >
              <span></span>
            </button>
          </div>

          <!-- 开关 2：允许 Agent 访问（仅4模块支持，其余明确不支持） -->
          <div class="control-row">
            <span class="control-label">{{ t('moduleManager.allowAgent') }}</span>
            <template v-if="isAgentSupported(module)">
              <button
                class="feature-switch agent-switch"
                :class="{ enabled: Boolean(module.agent_allowed) }"
                role="switch"
                :aria-checked="Boolean(module.agent_allowed)"
                :aria-label="t('moduleManager.agentSwitchAria', { name: formatModuleName(module) })"
                :title="formatAgentStatus(module)"
                :disabled="!module.available || !module.supported || pendingAgent === module.id"
                :aria-busy="pendingAgent === module.id"
                @click="toggleAgentAccess(module)"
              >
                <span></span>
              </button>
            </template>
            <template v-else>
              <span class="agent-unsupported-tag">
                {{ t('moduleManager.agentUnsupported') }}
              </span>
            </template>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { invokeIpc, type ModuleStatus } from '../api/ipc';
import Icons from './Icons.vue';
import { FEATURES } from '../utils/features';
import { t } from '../utils/i18n';

const props = defineProps<{ modules: ModuleStatus[]; opening?: string | null }>();
const emit = defineEmits<{ changed: []; open: [moduleId: string] }>();

/** A2 契约：仅四模块支持 Agent 访问，其余六项明确不支持且绝不显示授权开关 */
const SUPPORTED_AGENT_MODULES = new Set(['screenshot', 'clipboard', 'screen_ink', 'app_usage']);

function isAgentSupported(module: ModuleStatus): boolean {
  if (module.agent_supported !== undefined) {
    return Boolean(module.agent_supported) && SUPPORTED_AGENT_MODULES.has(module.id);
  }
  return SUPPORTED_AGENT_MODULES.has(module.id);
}

const pendingHuman = ref<string | null>(null);
const pendingAgent = ref<string | null>(null);
const error = ref('');

let humanSeq = 0;
let agentSeq = 0;

// 维护本地响应式副本，支持后端权威 catalog 返回和并发更新
const localModules = ref<ModuleStatus[]>([]);

watch(
  () => props.modules,
  (newModules) => {
    if (Array.isArray(newModules)) {
      localModules.value = JSON.parse(JSON.stringify(newModules));
    }
  },
  { immediate: true, deep: true }
);

const displayModules = computed(() =>
  localModules.value.length > 0 ? localModules.value : props.modules || []
);

/** 根据当前语言返回本地化模块名称 */
function formatModuleName(module: ModuleStatus): string {
  const key = `moduleManager.names.${module.id}`;
  const translated = t(key);
  return translated !== key ? translated : module.name;
}

/** 模块共享范围文案 */
function getAgentScopeText(moduleId: string): string {
  const key = `moduleManager.agentScope.${moduleId}`;
  const translated = t(key);
  return translated !== key ? translated : '';
}

/** 格式化人用运行状态文案 */
function formatModuleStatus(module: ModuleStatus): string {
  if (!module.available) {
    return t('moduleManager.statusPendingDev');
  }
  if (!module.supported) {
    return t('moduleManager.statusUnsupportedWinPin');
  }
  if (module.unavailable_reason) {
    return module.unavailable_reason;
  }
  return module.enabled ? t('moduleManager.statusEnabled') : t('moduleManager.statusDisabled');
}

/** 格式化 Agent 访问状态文案 */
function formatAgentStatus(module: ModuleStatus): string {
  if (!isAgentSupported(module)) {
    return t('moduleManager.agentUnsupported');
  }
  if (!module.available) {
    return t('moduleManager.statusPendingDev');
  }
  if (!module.supported) {
    return t('moduleManager.statusUnsupportedWinPin');
  }
  if (module.agent_allowed) {
    if (!module.enabled) {
      return t('moduleManager.agentIneffectiveNotice');
    }
    return t('moduleManager.statusEnabled');
  }
  return t('moduleManager.statusDisabled');
}

/** 切换功能开启/关闭 (人用开关) */
async function toggleEnabled(module: ModuleStatus) {
  const modId = module.id;
  const currentSeq = ++humanSeq;
  pendingHuman.value = modId;
  error.value = '';

  const previousState = module.enabled;
  const target = localModules.value.find((m) => m.id === modId);
  if (target) {
    target.enabled = !previousState;
  }

  try {
    const updated = await invokeIpc<ModuleStatus[] | null>('kernel_set_module_enabled', {
      module_id: modId,
      enabled: !previousState,
    });
    if (currentSeq === humanSeq) {
      if (Array.isArray(updated)) {
        localModules.value = updated;
      }
      emit('changed');
    }
  } catch (err) {
    if (currentSeq === humanSeq) {
      if (target) {
        target.enabled = previousState;
      }
      error.value = err instanceof Error ? err.message : String(err);
      emit('changed');
    }
  } finally {
    if (currentSeq === humanSeq) {
      pendingHuman.value = null;
    }
  }
}

/** 切换 Agent 访问授权 (Agent 开关) */
async function toggleAgentAccess(module: ModuleStatus) {
  const modId = module.id;
  if (!isAgentSupported(module)) {
    return;
  }
  const currentSeq = ++agentSeq;
  pendingAgent.value = modId;
  error.value = '';

  const previousAllowed = Boolean(module.agent_allowed);
  const target = localModules.value.find((m) => m.id === modId);
  if (target) {
    target.agent_allowed = !previousAllowed;
  }

  try {
    const updated = await invokeIpc<ModuleStatus[] | null>('kernel_set_agent_access', {
      module_id: modId,
      allowed: !previousAllowed,
    });
    if (currentSeq === agentSeq) {
      if (Array.isArray(updated)) {
        localModules.value = updated;
      }
      emit('changed');
    }
  } catch (err) {
    if (currentSeq === agentSeq) {
      if (target) {
        target.agent_allowed = previousAllowed;
      }
      error.value = err instanceof Error ? err.message : String(err);
      emit('changed');
    }
  } finally {
    if (currentSeq === agentSeq) {
      pendingAgent.value = null;
    }
  }
}
</script>

<style scoped>
.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  column-gap: 30px;
  row-gap: 12px;
}
.feature-row {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  padding: 16px 0;
  border-bottom: 1px solid var(--macos-border-subtle);
  min-width: 0;
}
.feature-icon {
  width: 38px;
  height: 38px;
  background: var(--macos-accent-subtle);
  color: var(--macos-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  flex: 0 0 auto;
  margin-top: 2px;
}
.inactive .feature-icon {
  background: var(--macos-bg-sidebar);
  color: var(--macos-text-tertiary);
}
.feature-info {
  flex: 1;
  min-width: 0;
}
.feature-title-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
h3 {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
}
.open-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--macos-accent);
  font-size: 11px;
  cursor: pointer;
}
.open-link:hover:not(:disabled) {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.open-link:disabled {
  color: var(--macos-text-tertiary);
  cursor: default;
}
.agent-scope-container {
  margin-top: 5px;
}
.scope-text {
  margin: 0;
  font-size: 11px;
  color: var(--macos-text-secondary);
  line-height: 1.4;
}
.ineffective-hint {
  display: inline-block;
  margin: 4px 0 0;
  font-size: 10px;
  color: #d97706;
  background: rgba(245, 158, 11, 0.1);
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid rgba(245, 158, 11, 0.25);
  line-height: 1.3;
}
.feature-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
  flex: 0 0 auto;
}
.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}
.control-label {
  font-size: 11px;
  color: var(--macos-text-secondary);
  white-space: nowrap;
  user-select: none;
}
.agent-unsupported-tag {
  display: inline-block;
  font-size: 10px;
  color: var(--macos-text-tertiary);
  background: var(--macos-bg-sidebar);
  border: 1px solid var(--macos-border-subtle);
  padding: 2px 7px;
  border-radius: 4px;
  white-space: nowrap;
  user-select: none;
}
.feature-switch {
  width: 32px;
  height: 19px;
  border-radius: 12px;
  border: 1px solid var(--macos-border-subtle);
  background: var(--macos-scrollbar-thumb);
  padding: 2px;
  cursor: pointer;
  flex: 0 0 auto;
  transition: background 0.15s, border-color 0.15s;
}
.feature-switch span {
  display: block;
  width: 13px;
  height: 13px;
  background: white;
  box-shadow: 0 1px 3px #0002;
  border-radius: 50%;
  transition: transform 0.15s;
}
.feature-switch.enabled {
  background: var(--macos-accent);
  border-color: var(--macos-accent);
}
.feature-switch.enabled span {
  transform: translateX(13px);
}
.feature-switch:disabled {
  opacity: 0.45;
  cursor: default;
}
button:focus-visible {
  outline: 2px solid var(--macos-accent);
  outline-offset: 3px;
}
.module-error {
  color: var(--macos-danger);
  font-size: 12px;
  margin-bottom: 10px;
  overflow-wrap: anywhere;
}
@media (max-width: 540px) {
  .feature-grid {
    grid-template-columns: 1fr;
  }
}
</style>
