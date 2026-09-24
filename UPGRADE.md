# 升级说明 · Upgrade notes

## 首次安装

没有安装过鲸鱼插件、也没有旧条目覆盖配置时，无需执行历史ID迁移。使用README给出的固定版本标识，在DSH插件管理器中安装并按需启用。

## 从 0.2.6 或更早版本升级

**不要只覆盖安装包并假定原启停设置仍然生效。**

旧条目ID：`dsh-plugin-whale-pet`。从0.2.7起的新条目ID：`whale-pet`。加载模块始终为`dsh-plugin-whale-pet`。

DSH使用ID匹配profile等配置层中的覆盖项。旧ID找不到目标时会警告并跳过：不会因此新增一只旧鲸鱼，但可能丢失原先的禁用或其他覆盖设置。

### 应当怎样迁移

1. 等正在运行的任务结束，记录原插件启停状态，并备份相关配置。
2. 关闭DSH，在停止期间统筹完成包更新和配置迁移；不要在运行任务期间改配置。
3. 检查实际生效的profile、全局以及额外overlay层。只把**属于本插件的ID定向覆盖项**从旧ID改为新ID，保持原`disabled`值、模块名和其余字段不变。
4. 如果新旧ID都已存在、存在自定义`insert`或模块归属不符，停止并人工检查，不能全文替换包名或猜测覆盖优先级。
5. 完成后再启动DSH。确认只有一条`whale-pet`记录，加载模块正确，启停状态与迁移前一致，并检查启动日志中是否仍有旧ID找不到的提示。

仅用于说明的片段，**不要拿它覆盖完整配置文件**：

```yaml
# 迁移前（这个示例原本是禁用状态）
- id: dsh-plugin-whale-pet
  disabled: true

# 迁移后：保留禁用状态，模块名不变
- id: whale-pet
  disabled: true
```

源代码中的迁移规划工具只处理内存中的补丁数据，不读写文件、不连接DSH，也不会在安装时执行。它不是自动升级程序，不能代替对所有生效配置层的检查。

## 从 0.2.7 或 0.2.8 测试版升级到正式 0.2.8

如果此前已正确完成ID迁移，本次不再更改ID，不需重复迁移。仍应在任务结束后更新，并保留自己的配置备份。

如果之前从旧版直接覆盖到0.2.7而没有处理覆盖项，请按上述说明检查遗留旧ID。本版本不会自动清理它们。

## 回退

回退涉及ID变更的版本时，包和覆盖配置必须对应：旧包使用旧ID，新包使用新ID。只恢复安装包不一定恢复原启停设置。请使用升级前备份，不在任务运行期间回退。

## 正式 0.2.8 的变化

正式版保留已由用户现场确认成功的庆祝同步修复：注册自定义 Remote 后，在声明了 `remote.whalePet` 依赖的子作用域中调用，避免请求在客户端即被拒绝。

临时“同步诊断”菜单、计数和诊断查询接口已经移除；正常设置和自动化回归测试保留。条目 ID 和偏好设置格式未变，不需要因移除诊断功能而清空偏好。

在 DSH 插件管理器中使用 `dsh-plugin-whale-pet@0.2.8` 更新。若之前依赖本地测试包，需要明确切换到这个 npm 版本；旧的 `@beta` 标识仍指向测试通道。等任务结束后再更新、完整退出并重开 DSH，确保加载新的 Host 和客户端模块。不要在任务运行期间升级。

正常完成已经有真实安装确认；其他版本/平台及全部并发、断线场景仍有验证边界，参见兼容说明。

---

**English summary:** releases up to 0.2.6 used entry ID `dsh-plugin-whale-pet`; 0.2.7 and later use `whale-pet`, while the module name stays unchanged. Migrate only the plugin's ID-targeted overrides, preserve their original enabled/disabled state, and review conflicting/custom layers manually. No automatic profile migration runs on install. Complete package/configuration changes while DSH is stopped, and verify the resulting entry and state before resuming work.
