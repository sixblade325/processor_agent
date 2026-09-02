## 文档职责
- 本文档描述水手处理器设计助手第二代产品实现计划。
- 吸收第一代经验，本文档底稿必须全部由人类撰写，agent只可参与完善工作。

## 最高准则
1. 文档驱动。龙芯杯-style Design 设计文档是处理器设计的唯一权威材料。

2. Less is More。Harness 保持极薄，不拥有、复制或解释处理器模型，对处理器语义保持无知，只管理文件版本、变更、审批、任务、运行和证据。Harness 状态越多，Harness 对设计过程的假设就越多；假设越多，用户和 Agent 可采用的设计路径就越少。V2 应以减少状态来增加设计自由度，而不是以增加状态来追求表面上的流程完备。

3. Humen First。产品一级概念和边界由用户设计；Agent 只提供证据、候选分析和实现。

## 产品功能边界
- 本产品的定位是：Processor Agent 是一个 AI-native、文档驱动、由处理器设计师主导的处理器设计工作台。它以龙芯杯式、可由用户直接维护的设计文档为权威，协助用户明确自己想要怎样的处理器，把 idea 落实为架构和微架构设计，再把经用户确认的设计落实为可追踪的实现、验证和修订证据。Agent 始终作为助理参与调研、方案分析、文档维护、缺口发现、实现与验证，但不替用户定义设计事实、关键取舍或新的产品概念。

- 产品核心闭环: Idea -> Architecture -> Design -> Implementation -> Verification -> Evidence-driven Revision。

- 产品宏观上分为 Define、Realize、Improve 三个阶段，它们是面向用户目标和工作节奏的宏观流程视图，不是产品内核的本质抽象。三者应复用同一套由薄 Harness 承载的基础能力，只通过不同的任务组合、输入产物和完成条件体现差异。

## 三个宏观阶段
- Define: 用户想要什么样的处理器
- Realize: 怎样把已明确的处理器设计并实现出来
- Improve: 怎样根据测量和验证证据改进现有设计
这三个宏观阶段不应分别拥有：独立的处理器数据模型, 状态体系, 修正机制, Agent Runtime, Evidence Store, 审批框架。
阶段之间真正稳定的边界是产物：

Define
-> 产生用户认可的 Architecture

Realize
-> 消费 Architecture
-> 产生 Design、Source 和 Verification Evidence

Improve
-> 消费当前 Design、Source 和测量 Evidence
-> 产生对现有 Design 的修改
-> 再复用 Realize 完成实现和验证

因此，“从 Define 进入 Realize”不必是一个复杂的 STAGE1_COMPLETE -> STAGE2_INIT 状态转换。它可以只是: 存在一份当前有效、由用户批准的 Architecture。“进入 Improve”也不必是 STAGE3_STARTED，而可以只是：存在一个经过验证的 baseline, 并且用户正在处理一个基于测量证据的设计改进

- 阶段名称可以保留在产品导航、交互方式和文档入口中，但不应构成一个非常严格的 harness。V2 不能只是把三个 Stage 的状态机写得更整齐，而应取消“每个 Stage 是一个独立工作流引擎”的前提。

## V2需要设计出什么
- 一套龙芯杯-style的，灵活、有效的文档管理系统。
- 一套基于极薄 Harness 的底层技术。

## 暂时不做什么
- 双 agent 轮转机制