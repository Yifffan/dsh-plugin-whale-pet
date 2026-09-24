# 气泡字体与许可

气泡采用两款免费、可商用的 OFL 字体。它们随插件内嵌，运行时不请求 Google Fonts、CDN 或其他字体服务，不要求用户安装系统字体。电脑屏幕的会话数字仍使用原来的本地 mono 字体，不应用这套气泡字体。

## 中文：站酷快乐体 · ZCOOL KuaiLe

- 来源：[@fontsource/zcool-kuaile 5.3.0](https://registry.npmjs.org/@fontsource/zcool-kuaile/5.3.0)，固定版本归档经 SHA-512 校验后提取；未执行 npm 包脚本。
- 上游：[ZCOOL KuaiLe 项目](https://github.com/googlefonts/zcool-kuaile)。
- 版权：Copyright 2018 The ZCOOL KuaiLe Project Authors。
- 原始许可：[OFL-ZCOOL-KuaiLe](assets/fonts/OFL-ZCOOL-KuaiLe.txt)，从已验证归档逐字节复制。
- 修改：只保留当前真正气泡文案所需、且由中文字体负责的字形（`state.*`、`working.*`、`celebrate.*`、`error.*` 及 `pet.greeting`）；菜单和设置翻译不参与子集，转换为 WOFF2；字形轮廓没有重新绘制。作为修改版，内部字体名改为 **Whale Bubble Han**，PostScript 名为 `WhaleBubbleHan-Regular`，字重 400。
- 产物：[bubble-zh.woff2](assets/fonts/bubble-zh.woff2)，10,888 字节。

## 英文：Fredoka 500

- 来源：[@fontsource/fredoka 5.3.0](https://registry.npmjs.org/@fontsource/fredoka/5.3.0)，固定版本归档经 SHA-512 校验后提取；未执行 npm 包脚本。
- 上游：[Fredoka 项目](https://github.com/hafontia/Fredoka-One)。
- 版权：Copyright 2016 The Fredoka Project Authors。
- 原始许可：[OFL-Fredoka](assets/fonts/OFL-Fredoka.txt)，从已验证归档逐字节复制。
- 使用原包的 `fredoka-latin-500-normal.woff2`，内容完全不变，实际 OS/2 字重为 500。其内部 family 是 `Fredoka Light Medium`、PostScript 名为 `FredokaLight-Medium`；这些是来源文件自身的命名，不代表实际使用轻体字重。运行时可用独立 CSS 别名 `Whale Bubble Latin` 注册。
- 产物：[bubble-en.woff2](assets/fonts/bubble-en.woff2)，16,248 字节。

两份字体合计 **27,136 字节，约 26.5 KiB**。当前所有气泡文案的实际字符都已验证覆盖。菜单、设置、恢复按钮等继续使用系统 UI 字体；它们独有的中文字形和 `↗` 不必保留在气泡子集中，新增菜单翻译不会扩大气泡字体。以后增加中文**气泡**文案需要重做子集/覆盖检查，而不是把未知字符静默替换成方框。

## 商用、内嵌与分发条件

两份原始许可证都是 **SIL Open Font License 1.1**：

- 允许商业使用、修改、内嵌，以及随软件一起分发或销售。
- 分发时必须保留对应作者版权声明和完整 OFL；本包随附两份原文。
- 不能把字体本身单独售卖。
- 修改版须遵守 Reserved Font Name 条件；本项目已对中文子集使用自己的字体名。
- 字体及其修改版仍受 OFL 约束，**不改授予本项目的 MIT 代码许可**；用字体排版生成的页面或图片本身不因此被要求采用 OFL。
- 上游作者名称仅用于来源与贡献说明，不暗示其为此插件背书。

这仅说明字体许可，不替代鲸鱼角色插画的授权确认。

## 可复现来源与工具

归档完整性：

```text
@fontsource/zcool-kuaile@5.3.0
https://registry.npmjs.org/@fontsource/zcool-kuaile/-/zcool-kuaile-5.3.0.tgz
sha512-jn4vpQ6QSVEckUn7uk5a9XcZMxEksTRqljmeE1VKRGMjGd6VoXdMyLGSdnTXSVwZLCCEHaIcm/2cdQuwvasJ9w==

@fontsource/fredoka@5.3.0
https://registry.npmjs.org/@fontsource/fredoka/-/fredoka-5.3.0.tgz
sha512-s2IhjQ50wDnKkkaKmjhtL0rxQg6ITsVusiipM3m7zUwVZZbbCKsscNDkngwp28xVzfIt7neWrkgU1qKqyTycQg==
```

本仓库提供已处理的字体、完整许可和产物清单。正常插件构建与安装不需要下载或重新处理字体。

中文子集制作时使用fonttools 4.61.1；首个公开快照未包含当时的研发下载/子集脚本，因此不承诺仅凭本仓库一键重现中文子集。需要新增中文气泡文案时，应从上述固定来源重新制作子集、保留OFL与修改版命名要求，并更新字体清单和字形覆盖测试。

产物名称、真实 family/PostScript 名、字形覆盖、字重、大小及 SHA-256 保存在[字体清单](assets/fonts/manifest.json)。
