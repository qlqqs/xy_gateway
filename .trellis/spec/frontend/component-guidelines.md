# Vue 组件规范

使用带有 `<script setup lang="ts">`、template 和 scoped style 的 Vue 3 单文件组件。项目统一使用 Ant Design Vue；新增自定义实现前先使用其表单、表格、弹窗、反馈和布局组件。组件名和文件名使用 PascalCase。

Props 使用本地 `Props` interface 和 `defineProps` 声明，可选值需要默认值时使用 `withDefaults`。事件使用类型化 `defineEmits`；只有父组件确实需要命令式调用时才 expose 方法（例如 `DialogCreate.vue` 暴露 `open`，`JsonViewer.vue` 暴露 `handleCopy`）。

```vue
<script setup lang="ts">
interface Props {
    title: string;
    value: string | number;
    description?: string;
    loading?: boolean;
}

defineProps<Props>();
</script>
```

复杂组件要明确声明 props 和事件两端的契约：

```ts
defineProps<{
    loading: boolean;
    value: string;
}>();

defineEmits<{
    submit: [value: string];
}>();
```

可复用组件只负责渲染和本地交互。页面负责路由和页面专属 API 调用，store 负责业务流程。可变的标量/可空值使用 `ref`，表单对象使用 `reactive`，派生显示值使用 `computed`，参照 `components/common/StatisticCard.vue` 和 `views/User/List.vue`。

按 Ant Design Vue 的要求使用 `v-model:value`/`v-model:open`，表格使用稳定的 `row-key`，图标按钮提供 `aria-label`（`views/User/List.vue` 是示例）。CSS 使用 scoped，并使用项目 CSS 变量（`--accent-primary`、`--text-secondary` 等）表达主题颜色。优先使用语义化 button 和可见文本，不要在非交互元素上绑定 click。

避免未类型化的 `any` props、修改 prop、在可复用组件中写死资源 URL，或在没有用户反馈和明确 best-effort 注释的情况下吞掉 API 失败。
