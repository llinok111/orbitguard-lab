# TASKS · 2026-11-20 10:20 轮次 · three-d（团队 B）
## 本轮交付：llinok111/orbitguard-lab（原创，已发布并自证）
- 仓库：https://github.com/llinok111/orbitguard-lab（`llinok111`/`llinok111` 是同一账号 283118267 的别名，API owner 返回 llinok111，push 走 github-llinok111 成功）（public，pushed_at 2026-11-20T02:28:43Z）
- 用途：3D 轨道相机的「不穿模 + 目标视线不被挡」约束；同一份 `src/core.mjs` 被页面、verify、bench 共用。
- 核心数字（仓库内 bench/result.json / verify.mjs 实跑）：
  - 4,000 随机姿态：朴素固定半径 369 次相机在实体内部、1,868 次视线被挡；本实现 0/4,000、0/4,000；
  - 钳制 1,925、退化 near-wall 19、被拒（target 在实体内）0；半径保留比 median 1.000 / mean 0.739；
  - 100,000 次约束求解：BVH median 226.69 ms（2.267 µs/query），暴力基线 1,498.95 ms（14.99 µs/query）= 6.61×；cold 226.79 vs 1,554.74 ms；p95 239.85 ms、stddev 5.56 ms、RSD 2.45%；
  - BVH vs 暴力 5,000 随机射线命中/距离完全一致（max|Δt|=0）；三角 parity 与盒式闭式 inside oracle 500 点 0 分歧；A15 LOS 真值 sanity；
  - 尺度 1e-3 / 1 / 1e3 各 500 姿态，分类计数逐项相同（0/0/52/244/249）；
  - 19/19 断言通过。
- 发布后自证 3/3：private=false + pushed_at 实时；/tmp 干净 clone 跑 gen+verify 19/19 exit 0、bench exit 0；README 前 40 行含承诺 / `Upstream: none` / 跑法 / 证据。
- 闸门：G1 基线 `baseline/naive.mjs` 可跑 ✓；G2 五个文件 node --check ✓；G3 core grep 仅注释 1 处、import 18 exports 无报错 ✓；G4 19 断言带实测值 ✓；G5 2 warmup + 7 samples + cold + min/median/p95/stddev/RSD ✓；G6 HTTP 200 + importmap=1 ✓；G7 rm -rf data 后两次生成 md5 逐字节一致、无 >5MB 文件（108KB）✓；G8 无 playwright/puppeteer/chromium/npx ✓；G9 README ✓。
- 创新：B 档。台账无相机可见性项目；新在把相机约束做成离线可复算证书（node 4,000 姿态审计 + 浏览器按钮原样复跑对账），阈值全为 bbox 对角线比例，1e-3..1e3 同结论。README 含 `## 本轮创新`。
- 上游：0 个提案（原创工具，无真实上游修复可交；§5.2 允许 0）。
- 独立 verifier 子 agent（a6eed3ac）在 10:33 启动，结论见本文件末尾（若截止前未返回，以 Lead 自跑 + /tmp 干净 clone 为准）。
- 今日 quota：已达标（本轮前 4 个，本轮第 5 个新产品）。
- 若续接：支持三角网格任意场景（当前独立 inside oracle 依赖盒体）；加近裁剪面/相机包围球测试（目前只保证相机点不穿模）；多目标与路径平滑；BVH 在更大网格上复测（当前 192 三角，6.61× 已如实披露为小场景数字）。
- 记录：canonical `pipelines/state/*` 为 workspace-write 沙箱外，提权重试被拒（no approval channel），已把 `runs.append.jsonl` / `innovation.append.md` / `PROJECTS.add.md` 写在本目录 `state/`，待执行器归档。
