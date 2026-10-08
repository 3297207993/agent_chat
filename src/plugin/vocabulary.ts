/**
 * 词汇表的宿主侧出口。
 *
 * 契约本体已搬到 `packages/plugin-api`（`@agent-chat/plugin-api`）——插件与宿主说的是同一份声明，
 * 插件不再需要用相对路径指进宿主的源码树。这里只是让宿主内部继续用 `@/plugin/vocabulary` 这个名字
 * （把这些调用点全部改路径没有收益）。
 *
 * `declare module "@cambia/core"` 的声明合并也随包走：只要本模块被纳入编译，`ctx.sessions` 之类的
 * 键位就有类型。
 *
 * 注意这里是 **`export type *`**（类型再导出）：契约包里没有实现，写成值再导出会让打包器真去解析
 * 一个不存在的运行时入口——"只有类型"这件事必须在每个出口上保持成立。
 */
export type * from "@agent-chat/plugin-api";
