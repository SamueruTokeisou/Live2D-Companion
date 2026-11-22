# 参数裁定与语义绑定（大肥鱼模型）

> 目的：把「能让 AI 临场编」和「必须绑骨化」分开。先裁定参数主次，再把情绪绑成配方。
> 数据来源：`大肥鱼.cdi3.json`（509 参数）、`大肥鱼.physics3.json`（131 条链、50 输入 / 292 输出）、
> `tmp/params.json`（运行时范围，由 `__stageRpc('paramInfo')` 导出）。

## 0. 一条硬规则：写点

| 写点 | 时机 | 能写什么 |
|---|---|---|
| `poseBus`（加性累加） | `onBeforePhysics` 之前 | 物理输入、头/身体/眼/嘴这类主控参数 |
| `layers.hold`（绝对值） | 物理之后、`update` 之前 | **物理输出**参数（腿、耳朵、头发、翻转…） |
| `life.js` 的 `add()` | 同上（`beforeModelUpdate`） | 在物理值上叠偏移，等效于 hold 但保留弹性 |

**不要把物理输出当状态读**：每帧会被物理重算，`param.get` 读到的是上一帧结果。

## 1. 主控参数（一级，直接驱动，不用 hold）

| 通道 | 参数 | 范围 | 说明 |
|---|---|---|---|
| 头 | `ParamAngleX/Y/Z` | ±30 | 转头 / 仰低头 / 歪头（**主要表现力**） |
| 眼珠 | `ParamEyeBallX/Y` | ±1 | 视线 |
| 眼开合 | `ParamEyeLOpen/ROpen` | 0–1.5 | 半闭眼、＞＜、眯眼 |
| 眉 | `ParamBrowLY/RY`、`ParamBrowLAngle/RAngle` | ±1 | 情绪主力，AI 最常用错的一层 |
| 嘴 | `ParamMouthOpenY`、`ParamMouthForm` | 0–1 / ±1 | 开合 / 嘴角 |
| 嘴形 | `Mouthpucker`、`MouthFunnel`、`MouthPuckerWiden`、`MouthX` | ±1 / 0–1 | 撅嘴、圆唇、嘴宽、努嘴位移 |
| 下巴 | `JawOpen` | 0–1 | 张大口（比只拉 MouthOpenY 自然） |
| 舌头 | `TongueOut`、`ParamTongueUpDown/Width` | ±1 / 0–1 | 吐舌、舌位（后者是输出） |
| 身体 | `ParamBodyAngleX/Y/Z` | ±30 | 胸腔三轴 |
| 盆骨 | `HipAngleX/Y/Z` | ±30 | 重心、扭腰 |
| 拖拽位移 | `ParamBodyAngleRX/RY` | ±30 | **物理输入**，喂给头发链，别给太大（见 §4） |
| 手臂 | `Param59/60/61/62`、`Movement1~3`、`Param36/39/40/41/42` | 归一 | 姿势族 + 族内微调（`poses.tune`） |

## 2. 次要参数：转动 / 翻转（二级）

这些**多数是物理输出**，只能"物理之后加性写"，但收益很高：加一点就有生气，不加以不至于错。

| 参数 | 名字 | 范围 | 用途 |
|---|---|---|---|
| `LFlip` / `RFlip` | Flip x | ±1 | **兽耳左右转**（扑棱时加 0.2~0.4 就自然很多） |
| `LFlip2` / `RFlip2` | Flip y | ±1 | 兽耳前后翻 |
| `LEar1~3` / `REar1~3` | 兽耳 PHA/B/C | ±1 | 竖耳 / 垂耳，越靠尖越滞后（鞭状） |
| `WingRotation` / `WingRotation2` | 翅膀旋转 | ±1 | 待机动画 |
| `LittleFlower13` | 花旋转 | ±1 | 花旋转 |
| `Param52` | 尾巴翻面 | ±1 | 尾巴正反面 |
| `ShineX` | 闪光旋转 | ±1 | 高光转动（低成本彩蛋） |
| `LEGAngleZ2` / `Param33` | 双腿转向 / 并分腿 | ±30 / ±1 | 只能 hold；常规靠动胯（见 SPEC §5.8） |

## 3. 纯物理输出（三级，292 个）

| 组 | 数量 | 说明 |
|---|---|---|
| 头配饰（耳环） | 45 | `LJewelry1~3` / `RJewelry1~3` 等 |
| 手臂 | 33 | `LForearm` 等，被姿势链占用 |
| 身体轴 | 29 | 位置/角度缓冲 |
| 后发物理 | 29 | `LateHairX1~5` / `LateSideHair*` / `ShortPonytail*` |
| 裙子 | 27 | 裙摆摆动 |
| 五官物理 | 29 | 眼珠/睫毛/高光/脸盘抖动/嘴唇 `LipPhysics1~3` / 舌头 |
| 眼睛 | 17 | 眼珠跟随 |
| 侧发物理 | 16 | `SideHairX/Y1~4`、`SideHairL/R*` |
| 兽耳 | 12 | `LEar*` / `REar*` / `Flip*` |
| 前发物理 | 8 | `FrontHairX/Y1~4` |
| 胸/上衣/尾巴/闪光/控制器/动画 | 18 | 次级摆动 |

**头发共 57 个输出**（前 8 + 侧 16 + 后 29 + 马尾若干），全部只能加性写。

## 4. 联动链路：50 个物理输入撬动 292 个输出

按引用链数排序（去重后的链数）：

| 输入 | 名字 | 驱动链数 |
|---|---|---|
| `ParamBreath` | 呼吸 | 30 |
| `PositionY` | OPY | 22 |
| `ParamBodyAngleZ` / `ParamBodyAngleX` | 胸腔 Z / X | 20 / 20 |
| `LeanInput` | 前倾 | 19 |
| `ParamAngleX/Y/Z` | 头三轴 | 17 / 14 / 15 |
| `ParamEyeLOpen/ROpen` | 眼开合 | 7 / 7 |
| `ParamBrowLY/RY` | 眉 | 7 / 7 |
| `ParamMouthForm` | 嘴形 | 6 |
| `Clothes2` | 体型 | 6 |
| `HipAngleX/Y/Z` | 盆骨 | 4 / 1 / 3 |

**既输入又输出**（可以用它"撬动整条链"，也最容易被物理吃掉）：
`ParamAngleX/Y/Z`、`ParamBodyAngleX/Y/Z/RX`、`HipAngleX/Y/Z`、`ParamBrowLAngle/RAngle(+Smoothing)`、`LControl`/`RControl`、`Emotion2`、`ShockL/R`。

### 结论

1. 想让**全身**动 → 动 `ParamBodyAngleX/Y/Z` + `HipAngle*`（物理输入，会带起头发/裙子/耳环）。
2. 想让**局部**生动 → 加性写输出（耳朵 Flip、耳朵 PHA、尾巴翻面）。
3. **不要**指望物理自动做出"情绪"：物理只认角度/速度的惯性，情绪必须靠语义配方叠。

## 5. 语义绑定（配方）

一个情绪 = 主通道（头/眼/眉/嘴）+ 次通道（耳转/扑棱/尾巴）的小幅度点缀。细节才是"活"。

以**傲娇**为例：

```
斜脸   ParamAngleZ +8        仰脸  ParamAngleY +6     偏头 ParamAngleX -10
半闭眼 ParamEyeLOpen/ROpen → 0.55
脸红   表情层「脸红」
耳朵   扑棱 1 次 + Flip x 0.3~0.5（耳尖再加 0.1 的延时）
嘴     嘴角 -0.3 + 撅嘴 0.4（努嘴时 MouthX 轻微偏移）
台词   「哼，才不是……」
```

配方表在 `src/stage/semantics.js`，由 `idle-motions` 转成关键帧动作，
可用 `【情绪|傲娇】`（等价于 `【动作|傲娇】`）触发。
目前覆盖：傲娇 / 害羞 / 生气 / 撒娇 / 惊讶 / 得意 / 委屈 / 嫌弃 / 好奇 / 困倦 / 慌乱 / 心动。

## 6. 现状与待办

- 已有：待机活气层（life.js，加性写头发/耳环/耳朵）、姿势族、成套动作、情绪配方（本文件 §5）。
- 缺：表情预设库太薄（模型 model3 里 `Expressions` 为空），大量"表情"其实是参数组合；
  下一步把常见表情直接做成 `.exp3.json` 或参数表，而不是每次让 AI 临场发挥。
