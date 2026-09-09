<template>
  <a-table :row-selection="rowSelection" :data-source="rows" />
  <a-modal v-model:visible="visible" title="演示弹窗" />
</template>

<script setup>
const rowSelection = {};
const rows = [];
const visible = false;
const formSchema = [{
  field: 'checkScene',
  component: 'Select',
  componentProps: { options: [{ label: '消防', value: 'fire' }] },
}];
</script>
