<script setup lang="ts">
import { onMounted, ref } from 'vue';

const props = defineProps<{
  title: string;
  warning: string;
}>();

const acknowledged = ref(false);
const storageKey = `fluxy-docs-danger:${props.title}`;

onMounted(() => {
  try {
    if (sessionStorage.getItem(storageKey) === '1') acknowledged.value = true;
  } catch {}
});

function acknowledge() {
  acknowledged.value = true;
  try {
    sessionStorage.setItem(storageKey, '1');
  } catch {}
}
</script>

<template>
  <div class="danger-gate" :class="{ 'is-open': acknowledged }">
    <div v-if="!acknowledged" class="danger-gate-wall">
      <p class="danger-gate-label">Dangerous command</p>
      <h2 class="danger-gate-title">{{ title }}</h2>
      <p class="danger-gate-warning">{{ warning }}</p>
      <button type="button" class="danger-gate-btn" @click="acknowledge">
        Show command
      </button>
    </div>

    <div v-else class="danger-gate-content">
      <div class="danger-gate-banner">
        <strong>Dangerous command.</strong>
        {{ warning }}
      </div>
      <slot />
    </div>
  </div>
</template>
