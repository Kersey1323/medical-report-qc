# 医学 CGEC 实验逻辑与工程接入契约

日期：2026-10-15。状态：已核查源码和既有实验产物，已按用户授权迁入新项目；未开始应用实现。本文件是同日《医学影像报告质控系统重建方案》的方法附录，与主 spec、后端架构共同构成设计文档。

## 1. 方法来源和当前决策

工程以 `/mnt/mydrive/LLM/LLM4CGEC/medical_validation/` 的医学实验为准，不直接照搬上游 `exam/` 中的训练框架。研究实现是推理时教师条件增强，没有训练或蒸馏新的 CGEC 学生。

用户已选择允许在线模型、本地 1.5B CGEC 学生、CPU 重排；默认执行诊断、CSC、CGEC、定位四项检查。设计采用实验已验证的 Qwen2.5-1.5B Base＋RAG 教师＋Reference-only，保持独立于第四章的 CPT/CSC 分支。

| 功能 | 实验依据 | 工程处理 |
| --- | --- | --- |
| 教师提示、结构化输出 | `run_exam_proxy.py` 中 `TEACHER_SYSTEM_PROMPT`、`TEACHER_RAG_USER_TEMPLATE`、`teacher_explain` | 保留原任务与事实约束，增加严格类型和语义校验 |
| 召回、重排、排除近重复 | 同文件 `TeacherRAG`、`duplicate_filter_reason` | 保留顺序、相似度计算与阈值，记录全部候选 |
| 1.5B 学生提示与输出提取 | `run_hf_student_proxy.py` 中 `make_prompt`、`clean_completion`、`generate_batches` | 复用完成式协议；单任务推理，不批跑五组消融 |
| 二阶段教师 | `run_two_stage_cgec.py` | 独立补充配置，首版默认关闭，不混入主链 |
| SEE | `evaluate_see.py` | 有 gold 的离线评测，不接入日常质控结论 |
| 112 条最终口径 | `recompute_clean_cgec_subset.py` 与当前输出 | 根据保留 ID、source、target 精确对应历史预测重算，不是重新推理 |

上述文件的绝对路径前缀均为 `/mnt/mydrive/LLM/LLM4CGEC/medical_validation/`。只读核查摘要和源码 SHA-256 位于 `/mnt/mydrive/LLM/rag-optimizer/output/compute-feasibility-20261015/cgec-experiment-logic-audit.json`。

## 2. 默认业务链路

```text
不可变原始影像描述
  → source-only 混合召回，最多 20 个候选
  → CPU FP32 BGE 重排全部候选
  → 排除原文完全匹配、双向包含、相似度 ≥0.95
  → 依重排顺序取有效 Top-5 表达证据
  → 在线教师：has_error / error_type / reference_correction / explanation
  → 原文＋教师参考修正＋固定示例，构建 Reference-only completion 提示
  → Qwen2.5-1.5B Base，BF16 greedy
  → 截止后续示例并提取首份报告，校验完整性
  → 与原文确定性对齐，展示学生建议、教师意见和证据
```

CGEC 读取原始描述，不读取 CSC 建议、诊断结论、定位输出、人工参考答案或已接受的其他建议。教师和学生均不接收 gold。源码 `main()` 的 `target`、顶层 `has_error=source!=target` 用于离线记录和评价，不能作为生产输入或发现错误的判断依据；业务中的教师判断应单独存放为 `teacher.has_error`。

RAG 只增强教师；学生不直接接收 Top-5 正文。不能再插入一次 RAG 综合问答，也不能让学生先独立纠错再把它作为教师原文。学生在教师判无错时仍执行，符合实验逐样本处理逻辑。

## 3. 召回、重排与过滤

- 索引沿用 `/mnt/mydrive/LLM/rag-optimizer/storage/direct_cache_qcrag_shared_20260430/QcRAG_dev_gold_span`。已有节点及向量直接恢复，不传空文档重建或重新嵌入全库。
- 实验 `TeacherRAG` 通过 RAGOptimizer 配置检索，候选池为 20；当前配置启用 embedding 与关键词召回，关闭图、摘要召回及查询扩展。上线需复制和指纹化实际检索配置、节点及索引版本；当前 YAML 不能反向证明历史运行时的每个内部参数。
- 保留现有 bge-m3 embedding 身份，固定 CPU；禁止换模型后复用旧向量，禁止自动把服务切回 GPU。
- 重排使用本地 `bge-reranker-v2-m3`，CPU FP32，`compute_score(..., normalize=True)`，按得分降序。重排全部 20 个候选后再过滤，不能先取 5 再过滤。历史摘要的服务地址为 `http://127.0.0.1:7998/rerank`，超时 120 秒；上线地址单独配置。
- 相似度归一化严格沿用 `re.sub(r"\s+", "", text)`，仅删除空白，不额外删标点、转简繁或改大小写。先排完全相同，再排任一方向的包含关系，最后使用 Python `SequenceMatcher(None, source, candidate).ratio()`，保留实验默认 autojunk 行为，阈值 `>=0.95`。
- 过滤原因保持 `exact_source_match / source_containment / near_duplicate_source`；超过使用数量的有效候选显示 `outside_context_top_k`，不称为近重复。候选 ID、原文、召回得分、重排得分、相似度、排序与排除原因分别保留。
- 重排失败不退回原始召回排序。工程适配还需拒绝非有限得分、重复或越界索引和不完整返回，不能把畸形响应当作成功重排；同分按原候选顺序稳定排序。
- 有效候选 1—4 条时使用实际条数并标明证据不足；0 条时该分支失败，错误码 `no_valid_evidence`。这与旧 `teacher_explain` 空 context 时退回 WoRAG 的行为不同，是明确的工程保护，禁止静默改方法。
- 若与第四项定位共享候选缓存，缓存保存全部候选及与 Top-k 无关的可用性，CGEC 和定位分别标记 Top-5/Top-10。不能直接复用 CGEC 的 `included` 布尔值让定位只看到 5 条。只有输入、索引、检索、重排、过滤指纹完全一致才共享；发生任一配置差异就独立计算。

CPU 服务需显式锁定 CPU。旧 `rerank_server_fp32.py` 的 `use_fp16=False` 只声明精度，没有显式设备绑定，不能仅凭文件名保证不使用 CUDA。

## 4. 教师协议

沿用实验的医学语法范围：

| error_type | 含义 |
| --- | --- |
| `word_order` | 语序不当 |
| `redundant_component` | 成分赘余 |
| `mixed_structure` | 句式杂糅 |
| `missing_component` | 成分残缺 |
| `connective_error` | 关联词错误 |
| `negation_structure` | 否定结构错误 |
| `no_error` | 未发现明确错误 |

提示遵循最小修改，不做风格润色，不改变病灶、部位、方位、数值、阴阳性。参考材料仅用于表达，不作为当前病例答案，冲突时以待检原文事实为准。提示词在实施时提取为有版本的纯资源，保持原始内容；任何修改创建新版本，不靠模型名相同宣称方法相同。

历史主实验保存的模型为 GPT-5.6-sol、reasoning effort=low、Responses API。新的在线角色必须记录实际 provider、model、API 模式、推理强度、输出限制与响应标识；模型不可用时不静默切换。主实验 Responses 请求并没有设置 temperature，不应把 Chat Completions 分支的 temperature=0、max_tokens=2048 硬套到它。工程为防止失控增加输出上限和超时，记录为工程配置。

教师响应要求：

- `has_error` 必须为 JSON boolean，不能使用旧 `bool(parsed.get(...))` 将字符串 `"false"` 转成真。
- `error_type` 必须属于上述枚举；参考修正与解释均为非空字符串。
- 无错必须同时满足 `has_error=false`、`error_type=no_error`、参考修正与本次模型输入一致。
- 有错必须使用实际错误类型，参考修正应产生非空编辑；否则按结构/语义不一致重试，不能补默认字段掩盖问题。
- 保留原始响应及校验错误，属于受控详情；普通日志不打印全文或凭据。
- 教师输出无效时不调用学生。最多 3 次尝试，瞬时异常退避；该行 CGEC 失败不终止其他分支或后续报告。

## 5. 本地学生协议

默认模型 `/mnt/mydrive/LLM/models/Qwen2.5-1.5B`，为未做 CGEC 专项微调的 Base。不能替换成 Medical-CPT、CSC adapter 或 7B Chat 并继续标为相同配置。

保留 `make_prompt(..., variant="reference_only")` 的固定示例与排列：

```text
中文医学影像报告语法纠错任务。采用最小修改原则，不改变临床事实，只输出纠正后的完整报告。
示例原始报告：双侧胸腔未见积液以及并、积气征。
示例纠正报告：双侧胸腔未见积液、积气征。
待纠正原始报告：{source}
教师参考纠正：{reference_correction}
纠正后的完整报告：
```

不使用 `apply_chat_template`；不加教师 type/explanation，不加 RAG 正文。教师类型和解释仍保存展示。教师参考和学生最终建议分别保存，不能直接把教师输出复制为学生结果；112 条既有 Base RAG 结果中二者有 8 条不同。

| 项目 | 实验源码设置 | 首版工程契约 |
| --- | --- | --- |
| 精度和设备 | BF16、SDPA、CUDA | 保留，纳入同一 GPU 推理进程 |
| batch | 默认 4 | 资源约束下固定 1，GPU 全局并发 1；标明调度差异 |
| padding | left，无 pad 时用 eos | 保留 |
| 采样 | `do_sample=False` | greedy，不启用温度采样 |
| 输入 | 默认最大 2048 tokens，旧脚本允许截断 | 保留上限，但预先完整计数，超限直接失败；禁止截断原文或教师参考 |
| 输出 | `min(768, source_token_count + 64)` | 保留 batch=1 对应计算，记录 token 数和停止原因 |
| EOS | tokenizer EOS 与有效的 `<\|im_end\|>` ID | 保留；token ID 必须与本地 tokenizer 核对 |
| cache | `use_cache=True` | 请求结束释放 KV，不释放常驻权重 |

本机用当前 tokenizer 对 112 条既有 Reference-only 提示计数，最长 649 tokens，没有超过 2048；它们均为单行原文，均保存 5 条教师证据。该核查没有运行生成模型。默认值不等于历史每次命令都显式使用该值，原摘要没有完整保存所有生成参数。

输出处理按实验 `normalize_prediction` 去外层代码围栏及已知前缀，再按 `clean_completion` 在后续“待纠正原始报告 / 示例原始报告 / 中文医学影像报告语法纠错任务”标记前停止，取首个非空物理行。保存原始 completion、提取结果及停止原因，后续示例不进入建议文本。

首版兼容多行描述：保留不可变原文；建立带原文偏移映射的单行模型视图，将换行序列转换为一个空格，其余内容不删除。不对 CGEC 做 128 字分块，避免改变语序上下文。该视图转换为工程适配并单独版本化；所有对齐回映射到原文，换行空白本身不作为语法错误提示。对回映射有歧义的修改标需复核，不能输出伪造精确 span。

空输出按原脚本的重新生成思路处理：最多总计 3 次学生尝试，再试采用 `min_new_tokens=max(8, source_token_count//2)`，不改变模型、提示或输出预算；若该下限超过输出预算则立即报长度错误。不得把空输出转成原文并计为成功。达到生成上限、未见 EOS 或有效后续示例边界的输出标 `student_output_incomplete`，不能凭第一行非空就认定完整。首版不自动扩充上下文或改成教师直出。

## 6. 结论与人工复核

默认配置的建议文本取有效学生输出。教师的错误判断、参考修正、解释、学生建议和确定性编辑同时可查。教师和学生有不同意见时，保留各自结果，不添加实验中不存在的在线 SEE 裁判。

| 教师判断 | 学生相对原文 | 学生与教师参考 | CGEC 结论 |
| --- | --- | --- | --- |
| 无错 | 无修改 | 相同 | `no_issue` |
| 有错 | 有修改 | 相同 | `issue` |
| 无错 | 有修改 | 不同 | `needs_review` |
| 有错 | 无修改 | 不同 | `needs_review`，教师问题未解决 |
| 有错 | 有修改 | 不同 | `needs_review`，保留两份候选及差异 |

此表是工程展示策略，不是论文评价器。医学保护项检查发现可能改动部位、数量、大小、方位、属性或阴阳性时，结论升级为 `needs_review`；保护检查无法证明完整事实等价，不宣称自动保证正确。不依赖 gold 的前提下，模型输出与原文不同只是建议编辑，不能统计成“正确纠错”。

`cgec_rag_teacher_direct` 是单独选择的实验路径，返回教师参考；不在学生失败时静默启用。WoRAG、五组学生条件、7B Full EXAM 可在独立离线评测重跑，首版不增加消融管理界面，不为一次普通质控调用五次学生。

## 7. 二阶段与 SEE 的边界

教师二阶段补充实验只在第一阶段明确判无错时，使用同一原文和同一批证据复核；当前 112 条产物 eligible=2、used=2、changed_output_count=0。它不是默认 CGEC 教师链路，也不因零增益删除研究记录。首版关闭此补充路径；第四项 RAG 定位的“无错才二次复核”仍按其自身论文链路执行，两者不能混淆。

SEE 需要 source、人工 target、候选与 gold 概念编辑；其标签为 correct_edit、wrong_edit、reasonable_edit。当前实现每条含错报告计一个 gold 概念编辑；合理编辑不进入 precision 错误分母。SEE 是模型评价，不是无人工答案的生产判断。

当前论文口径是 112 条（107 含错、5 无错）；历史目录名 172 或数据路径中的 200 不表示当前条数。清洗脚本按 source/target 精确匹配历史输出、按当前 metadata 的 ID/顺序重算，没有新调用模型。当前 Base RAG Reference-only Segment F1 为 77.889%，Full EXAM 为 71.139%；CPT Reference-only 为 70.828%。这些是方法选择依据，不能作为新系统或临床效果承诺。

论文严格编辑指标会忽略空白；线上原文及偏移不能按此评价归一化删除空白。不能把 Segment F1、SEE F0.5、报告语义正确率或日常任务完成率混成一个“准确率”。

## 8. 实施验收

1. 用固定合成文本核对实验教师提示及 Reference-only 提示：两者都不含 target 或其他质控分支建议；教师接收 Top-5 正文，学生不接收检索正文及教师 type/explanation，固定完成式示例保持一致。
2. 检索依次覆盖原文完全相同、双向包含、0.95 阈值及边界，验证重排后过滤与稳定排序，检查全部候选可追溯。
3. 重排 NaN、重复/越界索引、返回不完整、服务失败、零有效证据均显式失败；1—4 条证据如实记录。
4. 模拟教师 JSON 字符串 false、枚举矛盾、无错却改文、空参考、空解释，验证不会触发学生或产生通过结论。
5. 验证 Base 无 chat 模板、BF16 greedy、batch=1、正确 EOS、输入计数和动态输出预算；模拟空结果、接续示例和生成截断，禁止静默返回原文。
6. 验证教师无错仍运行学生、教师学生分歧矩阵、医学保护项提示、多行视图和原文偏移回映射。
7. 每个阶段、每次尝试持久化，学生重试复用本次已验证教师和证据，不因重试更换教师参考；批量中任一阶段失败继续其他分支和后续行。
8. 真模型联调只用合成报告，核对教师、学生和 CPU 重排实际身份、设备及资源；112 条留出数据重评为单独显式任务，不作为启动自检。

本轮只完成静态核查、纯函数探测和既有产物一致性检查，没有发送在线请求、运行学生权重推理、安装依赖或修改研究项目。
