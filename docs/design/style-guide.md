# iMuninn 设计风格档案

> 版本 2（2026-11-07：颜色改用 OKLCH，确定 App 图标）。从 `mobile/src/ui/theme.ts` 与 `mobile/src/ui/components.tsx` 提取，作为三端（iOS、Android、Web 查看器）共同的设计依据，也可以直接作为 Claude 的设计系统资料使用。
> 对应的在线设计系统：Claude 中的「iMuninn」Design System。改动 token 时两边同步。

## 1. 产品气质

iMuninn 把手机变成传感器服务器：相机、深度、IMU、AR 位姿通过局域网推给 PC。界面的工作是让人一眼看懂**设备是否在线、谁在控制、数据是否在流动**，其余让位给相机预览。

- **工具感，不是消费 App。** 深色、克制、信息密集，像仪器面板。
- **数据先于装饰。** 数字一律等宽数字（tabular-nums），单位用弱化色跟在数值后。
- **状态用形状+颜色双编码。** 圆点、胶囊、徽章，不只靠颜色。
- **预览是主角。** 预览框纯黑、圆角 12，叠加层半透明黑底。

## 2. 跨平台原则（已确认）

| 层 | 规则 |
| --- | --- |
| 品牌元素 | 三端**保持一致**：相机预览框与叠加层、状态胶囊、数据卡片（Card / Stat / Row）、配色、图标 |
| 系统控件 | **随平台走**：iOS 用 `@expo/ui` 的 SwiftUI 控件（Switch、Picker、TextField、Button、Menu）；Android（恢复开发后）用 `@expo/ui` 的 Jetpack Compose；Web 用原生 HTML 控件（`<input>`、`<select>`、`<button>`） |
| 图标 | SF Symbols（`expo-symbols`）；Android / Web 用对应的 Material Symbols 或同名 SVG 作替代，语义映射见第 6 节 |
| Token | 唯一来源是 `mobile/src/ui/theme.ts`；Web 查看器（`host/web/src/style.css`）与文档站（`site/src/styles/custom.css`）从同一份值生成 CSS 变量 |

判断一个元素属于哪一层：用户会把它认作「iMuninn 的样子」的（状态胶囊、统计格、预览）是品牌元素；用户期待它「和系统里其他 App 一样」的（开关、文本框、菜单、弹窗）是系统控件。

## 3. 颜色

所有颜色以 **OKLCH** 定义（2026-11-07 定稿）。中性色共用约 245–265 的蓝灰色相、极低色度；状态色在同一主题内亮度相近。HEX 是换算值：React Native 不支持 `oklch()`，App 的 `theme.ts` 用 HEX 并在注释里写 OKLCH；Web 查看器和文档站直接写 `oklch()`。

| Token | 深色 | 浅色 | 用途 |
| --- | --- | --- | --- |
| `bg` | `oklch(17.0% 0.012 255)` #0C1015 | `oklch(98.0% 0.003 248)` #F7F9FA | 页面背景 |
| `card` | `oklch(22.0% 0.016 257)` #161B22 | `oklch(100.0% 0.000 0)` #FFFFFF | 卡片底色 |
| `card-alt` | `oklch(25.5% 0.026 265)` #1D2330 | `oklch(95.8% 0.006 255)` #EEF1F5 | 卡片内次级面：统计格、状态胶囊 |
| `text` | `oklch(94.0% 0.011 245)` #E5ECF2 | `oklch(25.5% 0.011 254)` #1F2328 | 主文字 |
| `muted` | `oklch(66.5% 0.018 251)` #8C959F | `oklch(49.5% 0.022 251)` #59636E | 次要文字：标签、副标题、单位 |
| `border` | `oklch(33.0% 0.015 252)` #30363D | `oklch(88.0% 0.013 244)` #D1D9E0 | 分隔线、控件描边 |
| `accent` | `oklch(62.0% 0.190 258)` #3082F6 | `oklch(57.0% 0.200 260)` #236FEA | 链接、选中描边、强调文字 |
| `accent-fill` | `oklch(57.0% 0.200 260)` #236FEA | `oklch(57.0% 0.200 260)` #236FEA | 主按钮、选中 Chip 底色（白字 4.6:1） |
| `on-accent` | `oklch(100.0% 0.000 0)` #FFFFFF | `oklch(100.0% 0.000 0)` #FFFFFF | accent-fill / danger-fill 上的文字 |
| `ok` | `oklch(70.0% 0.180 146)` #40BB53 | `oklch(51.5% 0.140 148)` #167C34 | 服务在线、追踪正常 |
| `warn` | `oklch(85.7% 0.133 90)` #F2CC60 | `oklch(84.0% 0.165 92)` #F1C623 | 警告圆点；浅色下也是徽章底色 |
| `warn-surface` | `oklch(29.6% 0.023 96.6)` #302D20 | `oklch(84.0% 0.165 92)` #F1C623 | 「被 PC 控制」徽章底色（深色为淡黄底） |
| `on-warn` | `oklch(85.7% 0.133 90)` #F2CC60 | `oklch(25.5% 0.011 254)` #1F2328 | 徽章文字 |
| `warn-text` | `oklch(85.7% 0.133 90)` #F2CC60 | `oklch(53.5% 0.110 80)` #8E6503 | 警告数值与文字（浅色下 5.2:1） |
| `err` | `oklch(66.5% 0.205 27)` #F85149 | `oklch(55.5% 0.200 25)` #CE2930 | 服务失败、● REC、错误文字 |
| `danger-fill` | `oklch(58.5% 0.200 27)` #D93632 | `oklch(55.5% 0.200 25)` #CE2930 | 危险按钮底色 |
| `preview-bg` | `#000000` | `#000000` | 预览框底色，两种模式都为纯黑 |
| `scrim` | `rgba(0,0,0,0.45)` | 同左 | 预览叠加层底色，文字始终用深色主题的 `text` |

与旧值相比的变化：
- 暗色 `warn` 从 `#D29922` 改为 `#F2CC60`（浅奶黄），因为黑底配大块橙黄再加黑字，容易让人联想到某个成人网站的配色。「被 PC 控制」徽章也从实心块改成淡黄底（`warn-surface`）配黄字，并加 1px `warn` 描边。
- 浅色 `warn` 改成亮黄 `#F1C623`，用于圆点和徽章底色，徽章文字用深色。黄色要在白底上达到 4.5:1 就一定会偏棕，所以另设 `warn-text #8E6503`，只用在白底上的警告数字和文字上。
- 新增 `accent-fill`、`danger-fill`、`on-accent`，修正按钮文字对比度（旧值只有 3.2:1 和 2.8:1）。
- 其余颜色经 OKLCH 取整后与旧值相差在 1–2 个色阶以内，肉眼几乎看不出。

状态色映射（来自 `App.tsx`）：
- 服务：`listening` → ok，`failed` → err，其它 → muted
- 追踪：`normal` → ok，`limited` → warn，其它 → muted
- 编码丢帧 > 0 → warn-text；录制中 → err

## 4. 文字

字体：系统字体（iOS SF Pro / Android Roboto / Web `system-ui`）。数值一律 `tabular-nums`。

| 样式 | 字号 | 字重 | 颜色 | 用在 |
| --- | --- | --- | --- | --- |
| `title` | 24 | 700 | text | 顶部「iMuninn」 |
| `statValue` | 18 | 600 | text，可被状态色覆盖 | 统计格数值 |
| `cardTitle` | 15 | 600 | text | 卡片标题 |
| `body` / `key` | 14 | 400 | muted | 行标签 |
| `val` | 14 | 400 | text | 行数值（右对齐、等宽数字） |
| `btnText` | 14 | 600 | text / onAccent | 按钮 |
| `streamTitle` | 14 | 600 | text | 卡片内的数据流小标题 |
| `chip` | 13 | 400 | muted；选中 text | Chip |
| `caption` | 12 | 400 | muted | 副标题、说明、错误（err） |
| `pill` | 12 | 600 | text | 状态胶囊、徽章 |
| `overlay` | 12 | 400 | 浅色，等宽数字 | 预览叠加层 |
| `statLabel` / `statUnit` | 11 | 400 | muted | 统计格标签与单位 |

## 5. 间距与圆角

间距（实际出现过的值）：2、4、5、6、8、10、12、14、16。
建议收敛为 4 的倍数加两个细值：`2, 4, 6, 8, 10, 12, 14, 16`（5 只出现在胶囊与小按钮的垂直内边距，可改为 4 或 6）。

| 用途 | 值 |
| --- | --- |
| 页面左右边距 | 16 |
| 卡片之间 | 12 |
| 卡片内边距 | 14，内部 gap 10 |
| 统计格内边距 | 10，gap 2；格之间 8 |
| Chip 之间 | 8 |
| 按钮内边距 | 14 × 9；小按钮 10 × 5 |

圆角：

| Token（建议名） | 值 | 用在 |
| --- | --- | --- |
| `radius-dot` | 4 | 8×8 状态圆点 |
| `radius-xs` | 6 | 徽章 |
| `radius-sm` | 8 | 按钮、输入框 |
| `radius-md` | 10 | 统计格 |
| `radius-lg` | 12 | 卡片、预览框 |
| `radius-pill` | 14 / 16 | 状态胶囊（14）、Chip（16） |

## 6. 图标

### 6.1 App 图标（已定稿）

小写 **i** 加与它等高的大写 **M**，i 上的点是红色录制环（细环 + 实心红心），表示「正在记录」。环的顶端与 M 顶端对齐，i 竖笔底端与 M 底端对齐。字母是手写的 SVG 几何：i 是圆角矩形，M 是一条四段折线加粗描边（圆角连接、圆头），不依赖字体。

尺寸（1024 画布）：i 宽 120、高 364；M 笔画 108、两腿中心距 384；录制环外径 144、环宽 12；红心直径 76。

| 版本 | 底 | 字母 | 录制环 | 文件 |
| --- | --- | --- | --- | --- |
| 深色（默认） | `bg` 深色 #0C1015 | `text` 深色 #E5ECF2 | `err` 深色 #F85149 | `docs/design/icons/imuninn-icon-dark.svg` |
| 浅色 | #FFFFFF | `text` 浅色 #1F2328 | `err` 浅色 #CE2930 | `docs/design/icons/imuninn-icon-light.svg` |

原稿是 1024×1024 方形，iOS 会自己裁圆角。**字标**（`docs/design/icons/imuninn-wordmark-{dark,light}.svg`）用同一几何：i + 录制环、M，再加同笔画（108）的 `uninn`，小写 x 高度 = i 竖笔高度，第二个 i 用实心点；文档站左上角用它替代文字标题。浅色版用于文档站 favicon 和浅色场景。之前排除的方向：渡鸦头（太像卡通）、圆头 iM 加实心红点（结构接近小米旧 logo）。

### 6.2 界面图标

- iOS：SF Symbols，经 `expo-symbols` 的 `<SymbolView>`；尺寸 16（行内）、20（按钮）、24（标题栏），颜色取 token，不用多色符号，状态图标可用 `hierarchical` 渲染。
- 不再用文字字符代替图标（目前卡片折叠用 `▾ ▸`、需重启参数用 `↻`、录制用 `●`）。

建议的语义映射：

| 含义 | SF Symbol | Material Symbol（Android / Web） |
| --- | --- | --- |
| 折叠 / 展开 | `chevron.down` / `chevron.right` | `expand_more` / `chevron_right` |
| 需重启生效 | `arrow.clockwise` | `restart_alt` |
| 录制中 | `record.circle.fill` | `radio_button_checked` |
| 全屏 / 退出全屏 | `arrow.up.left.and.arrow.down.right` / `arrow.down.right.and.arrow.up.left` | `fullscreen` / `fullscreen_exit` |
| 预览开关 | `eye` / `eye.slash` | `visibility` / `visibility_off` |
| 黑屏模式 | `moon.fill` | `dark_mode` |
| PC 已连接 | `desktopcomputer` | `computer` |
| 网络服务 | `antenna.radiowaves.left.and.right` | `cell_tower` |
| 相机 / 深度 / IMU | `camera` / `cube.transparent` / `gyroscope` | `photo_camera` / `deployed_code` / `explore` |
| 配置档 | `slider.horizontal.3` | `tune` |

## 7. 组件清单

品牌组件（三端一致，自绘）：

| 组件 | 现状 | 规格 |
| --- | --- | --- |
| **StatusPill** 状态胶囊 | `S.pill` + `S.dot` | cardAlt 底、圆角 14、内边距 10×5、gap 6；8px 圆点（ok/warn/err/muted）+ 12/600 文字，最宽 170，超出截断 |
| **Badge** 徽章 | `S.badge` | `warn-surface` 底、`on-warn` 字、1px `warn` 描边（深色）、12/700、圆角 6、内边距 8×4；「被 PC 控制」，点按接管 |
| **Preview** 预览框 | `Preview.tsx` | 纯黑、圆角 12；竖屏 3:4（紧凑 4:3）、横屏 4:3，视频等比适配加黑边；底部叠加层 scrim 底、12px 等宽数字、gap 12，录制时显示 err 色「● REC」 |
| **Card** 卡片 | `Card` | card 底、圆角 12、内边距 14、gap 10；标题 15/600，右侧可放操作；可折叠 |
| **Stat** 统计格 | `Stat` | cardAlt 底、圆角 10、内边距 10；标签 11 muted，数值 18/600 等宽，单位 11 muted；三列自动换行（flexBasis 30%） |
| **Row** 键值行 | `Row` | 左标签 14 muted，右数值 14 text 右对齐等宽；最小高 24；数值可着状态色 |
| **StreamBlock** 数据流分组 | `S.streamBlock` | 顶部 1px border 分隔，上内边距 10，小标题 14/600 |

系统控件（随平台）：

| 控件 | 现状（RN） | iOS 目标 | Android 目标 | Web 目标 |
| --- | --- | --- | --- | --- |
| 开关 | RN `Switch` | `@expo/ui/swift-ui` `Switch` | Compose `Switch` | `<input type="checkbox" role="switch">` |
| 枚举选择 | 自绘 `Chip` 组 | ≤4 项用分段 `Picker`（segmented），更多用 `Picker`（menu） | `SegmentedButton` / `DropdownMenu` | `<select>` 或单选按钮组 |
| 数值输入 | `NumberField`（− 文本框 +） | `TextField` + `Stepper` | `OutlinedTextField` | `<input type="number">` |
| 按钮 | 自绘 `Button`（primary / ghost / danger） | SwiftUI `Button`（borderedProminent / bordered / destructive） | `Button` / `OutlinedButton` | `<button>` 加 token 样式 |
| 文本输入 | RN `TextInput` | `TextField` | `OutlinedTextField` | `<input>` |

Chip 保留为品牌元素的场景：配置档列表（点按应用、长按删除），因为它承载「iMuninn 的配置档」这个概念，而非普通选择器。

## 8. 改进建议

1. **补浅色模式。** `theme.ts` 拆成 `dark` / `light` 两套 `C`，导出 `useTheme()`（基于 `useColorScheme()`），`StyleSheet` 改为按主题生成；`StatusBar` 跟随主题。
2. **补缺的语义 token。** `onAccent`、`onWarn`、`accentFill`、`dangerFill`、`previewBg`、`scrim`，替换 `Preview.tsx` 里的 `#000` 和 `rgba(0,0,0,0.45)` 字面量。
3. **统一三端配色。** Web 查看器目前用另一套颜色（`--bg #121212`、`--accent #4fc3f7`），与 App 不一致；改为从 `theme.ts` 生成 CSS 变量（一个小脚本输出 `oklch()` 写法的 `tokens.css`，Web 与文档站都引入）。
4. **字号和间距命名。** 把散落的 11/12/13/14/15/18/24 收进 `T`（type scale），间距收进 `SP`、圆角收进 `R`，组件只引用名字。
5. **图标替换字符。** 引入 `expo-symbols`，按第 6 节替换 `▾ ▸ ↻ ●`。
6. **系统控件迁移。** 按第 7 节表格逐个换到 `@expo/ui`，先换 Switch 和枚举选择（收益最大），Button 最后换。
7. **对比度。** 第 3 节的取值全部按 WCAG 2.x 检查过：正文和次要文字 ≥ 5:1；按钮白字 ≥ 4.6:1；浅色 `ok` 在 `card-alt` 上 4.7:1，`warn-text` 在 `card-alt` 上 4.6:1。`border` 只有约 1.4:1，作分隔线可以，作 Chip 和输入框的唯一边界偏弱，随系统控件迁移一并解决。

## 9. 文案

- 中英双语（`i18n.ts`），默认跟随系统，可在 App 内或 iOS 设置里切换。
- 状态文案短：「2 台 PC」「启动中」「网络错误」「被 xxx 控制」。
- 数值带单位，单位用弱化色：`30 fps`、`12.4 MB`。
- 需要重启才生效的参数，用 `arrow.clockwise` 图标标出（替换现在的 `↻`）。
