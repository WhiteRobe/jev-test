export type QuestionType =
  | "truefalse"
  | "single"
  | "graphic"
  | "slider"
  | "longpress"
  | "puzzle";

export interface GraphicVisual {
  kind: "color" | "emoji" | "shape";
  /** color / shape 使用的颜色 */
  color?: string;
  /** emoji 图案 */
  emoji?: string;
  /** shape 的几何形状 */
  shape?: "circle" | "square" | "triangle" | "star" | "pentagon" | "hexagon";
  /** shape 的边长（px） */
  size?: number;
}

/** 滑块题：把滑块移动到 target（允许误差 tolerance，默认 0） */
export interface SliderSpec {
  min: number;
  max: number;
  step: number;
  target: number;
  unit?: string;
  tolerance?: number;
}

/** 拼图验证码的图像场景（纯 CSS 渐变渲染，不依赖任何外部图片资源） */
export interface PuzzleScene {
  /** 背景渐变起始色（上） */
  from: string;
  /** 背景渐变结束色（下） */
  to: string;
  /** 高光圆形（太阳 / 光斑）颜色 */
  accent: string;
  /** 高光中心（相对图宽 / 图高比例，0–1） */
  accentX: number;
  accentY: number;
  /** 高光半径（相对图宽比例） */
  accentR: number;
}

/** 拼图验证码题参数：把缺图块拖动到图片中缺口的位置 */
export interface PuzzleSpec {
  scene: PuzzleScene;
  /** 缺口中心（相对图宽 / 图高比例，0–1） */
  gapX: number;
  gapY: number;
  /** 判定容差：落点与缺口的归一化距离不超过该值即算正确 */
  tolerance: number;
}

export interface QuestionOption {
  id: string;
  /** 文字选项内容（判断题 / 单选题） */
  text?: string;
  /** 图形选项的渲染描述（图形题） */
  visual?: GraphicVisual;
  /** 该选项的文字描述，用于结果页回看 */
  label: string;
}

export interface Question {
  id: number;
  type: QuestionType;
  section: string;
  prompt: string;
  options: QuestionOption[];
  /** 正确选项的 id（判断 / 单选 / 图形题） */
  answer: string;
  explanation: string;
  /** 滑块题参数 */
  slider?: SliderSpec;
  /** 长按题：需要持续按住的毫秒数 */
  holdDuration?: number;
  /** 拼图验证码题参数 */
  puzzle?: PuzzleSpec;
}

const tf = (
  id: number,
  prompt: string,
  answer: "T" | "F",
  explanation: string,
): Question => ({
  id,
  type: "truefalse",
  section: "判断对错",
  prompt,
  options: [
    { id: "T", text: "✓ 对", label: "对" },
    { id: "F", text: "✗ 错", label: "错" },
  ],
  answer,
  explanation,
});

const single = (
  id: number,
  prompt: string,
  options: Array<[string, string]>,
  answer: string,
  explanation: string,
): Question => ({
  id,
  type: "single",
  section: "单项选择",
  prompt,
  options: options.map(([optId, text]) => ({ id: optId, text, label: text })),
  answer,
  explanation,
});

/** 图形题快捷构造 */
const graphic = (
  id: number,
  prompt: string,
  answer: string,
  explanation: string,
  options: QuestionOption[],
): Question => ({
  id,
  type: "graphic",
  section: "图形点选",
  prompt,
  answer,
  explanation,
  options,
});
const colorOpt = (id: string, color: string, label: string): QuestionOption => ({
  id,
  visual: { kind: "color", color },
  label,
});
const emojiOpt = (id: string, emoji: string, label = emoji): QuestionOption => ({
  id,
  visual: { kind: "emoji", emoji },
  label,
});
const shapeOpt = (
  id: string,
  shape: Exclude<GraphicVisual["shape"], undefined>,
  color: string,
  label: string,
  size = 56,
): QuestionOption => ({
  id,
  visual: { kind: "shape", shape, color, size },
  label,
});

/** 滑块题快捷构造（归入「人机交互检测」板块） */
const sliderQ = (
  id: number,
  prompt: string,
  spec: SliderSpec,
  explanation?: string,
): Question => ({
  id,
  type: "slider",
  section: "人机交互检测",
  prompt,
  options: [],
  answer: String(spec.target),
  slider: spec,
  explanation: explanation ?? `将滑块精确移动到 ${spec.target}${spec.unit ?? ""}。`,
});

/** 长按题快捷构造：在 4 个色块中长按 answerId 指定的颜色 holdMs 毫秒 */
const longpressQ = (
  id: number,
  colorName: string,
  answerId: string,
  options: QuestionOption[],
  holdMs = 3000,
): Question => ({
  id,
  type: "longpress",
  section: "人机交互检测",
  prompt: `请【长按】${colorName}的按钮，持续按住不放，直到进度走完（${holdMs / 1000} 秒）`,
  options,
  answer: answerId,
  holdDuration: holdMs,
  explanation: `需要在 ${colorName}按钮上连续按住 ${holdMs / 1000} 秒；中途松开不算完成，长按其他颜色则判错。`,
});

/** 拼图题落点的记录格式：归一化坐标 "x,y"（图内比例，0–1） */
export const formatPuzzlePoint = (x: number, y: number): string =>
  `${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000}`;

/** 解析拼图题记录的落点，格式非法时返回 undefined */
export const parsePuzzlePoint = (raw: string): { x: number; y: number } | undefined => {
  const [x, y] = raw.split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
};

/** 拼图落点是否在缺口容差内 */
export const puzzleHit = (spec: PuzzleSpec, point: { x: number; y: number }): boolean =>
  Math.hypot(point.x - spec.gapX, point.y - spec.gapY) <= spec.tolerance;

/** 拼图验证码题快捷构造（归入「人机交互检测」板块）：把缺图块拖到缺口位置 */
const puzzleQ = (
  id: number,
  prompt: string,
  spec: PuzzleSpec,
  explanation: string,
): Question => ({
  id,
  type: "puzzle",
  section: "人机交互检测",
  prompt,
  options: [],
  answer: formatPuzzlePoint(spec.gapX, spec.gapY),
  puzzle: spec,
  explanation,
});

export const QUESTIONS: Question[] = [
  // ================= 一、判断对错（1–50） =================
  // ---- 技术常识（1–10） ----
  tf(1, "Cloudflare Workers 可以在全球边缘节点运行 JavaScript / TypeScript 代码。", "T",
    "Workers 代码部署在 Cloudflare 全球边缘网络，就近响应请求。"),
  tf(2, "HTTP 状态码 404 表示服务器内部错误。", "F",
    "404 表示资源未找到（Not Found）；服务器内部错误是 500。"),
  tf(3, "wrangler dev 可以在本地预览 Worker 项目。", "T",
    "wrangler dev 会启动本地开发服务器，用于调试 Worker / 静态资源。"),
  tf(4, "CSS 里 flex 是 display 属性的合法取值。", "T",
    "display: flex 用于创建弹性布局容器。"),
  tf(5, "localStorage 中的数据在浏览器关闭后必然被清空。", "F",
    "localStorage 会持久保存；关闭标签页/浏览器即清空的是 sessionStorage。"),
  tf(6, "执行 git commit 后，代码会自动推送到远程仓库。", "F",
    "commit 只写入本地仓库，还需要执行 git push 才会推送到远程。"),
  tf(7, "TypeScript 是 JavaScript 的超集。", "T",
    "TypeScript 在 JavaScript 之上增加了静态类型系统，合法的 JS 也是合法的 TS。"),
  tf(8, "Promise 一旦 resolve，再调用 reject 不会改变其状态。", "T",
    "Promise 状态只会从 pending 变为 fulfilled / rejected 一次，之后不可更改。"),
  tf(9, "HTTPS 的默认端口是 80。", "F",
    "HTTPS 默认端口是 443，HTTP 默认端口才是 80。"),
  tf(10, "Array.prototype.map 会修改原数组。", "F",
    "map 返回一个由返回值组成的新数组，不会修改原数组。"),
  // ---- 简单数学（11–20） ----
  tf(11, "7 × 8 = 56。", "T", "七八五十六。"),
  tf(12, "15 − 9 = 7。", "F", "15 − 9 = 6。"),
  tf(13, "12 × 12 = 144。", "T", "12 的平方是 144。"),
  tf(14, "100 ÷ 4 = 25。", "T", "100 平均分成 4 份，每份是 25。"),
  tf(15, "0.5 + 0.25 = 0.75。", "T", "0.5 加四分之一等于 0.75。"),
  tf(16, "2 的 10 次方等于 512。", "F", "2¹⁰ = 1024，2⁹ 才是 512。"),
  tf(17, "两个负数相乘，结果是正数。", "T", "负负得正，例如 (−3) × (−2) = 6。"),
  tf(18, "正方形的边长是 4，它的周长是 16。", "T", "正方形周长 = 边长 × 4 = 16。"),
  tf(19, "直径所对的圆周角是 90 度。", "T", "泰勒斯定理：直径所对的圆周角为直角。"),
  tf(20, "3/4 大于 2/3。", "T", "3/4 = 0.75，2/3 ≈ 0.667，因此 3/4 更大。"),
  // ---- 文字 / 成语（21–30） ----
  tf(21, "“锲而不舍”中的“锲”读作 qiè。", "T", "“锲”读 qiè，意思是用刀子刻。"),
  tf(22, "“川流不息”形容行人、车马等像水流一样连续不断。", "T",
    "川：河流；像河水那样流个不停。"),
  tf(23, "“不以为然”的意思是“不认为是对的”，表示不同意。", "T",
    "然：对；不认为正确，多含轻视意味。"),
  tf(24, "“首当其冲”比喻最先受到攻击或遭到灾难。", "T",
    "冲：要冲、交通要道；该成语指最先受到冲击。"),
  tf(25, "“美不胜收”中“胜”的意思是“尽、完全”。", "T",
    "美好的东西太多，一时看不过来；胜：尽。"),
  tf(26, "汉字“凹”和“凸”都是 5 画。", "T", "“凹”“凸”的规范笔画数均为 5 画。"),
  tf(27, "“他兴高采烈地跑过来”这句话没有错别字。", "T", "“兴高采烈”书写正确。"),
  tf(28, "成语“按步就班”的写法是正确的。", "F", "正确写法是“按部就班”，“部”指门类。"),
  tf(29, "成语“破斧沉舟”的写法是正确的。", "F", "正确写法是“破釜沉舟”，“釜”是锅。"),
  tf(30, "“脍炙人口”中，“脍”指切细的肉，“炙”指烤熟的肉。", "T",
    "脍炙人口比喻好的诗文受到人们的称赞和传诵。"),
  // ---- 古诗词（31–40） ----
  tf(31, "“床前明月光，疑是地上霜”出自李白的《静夜思》。", "T",
    "这是李白《静夜思》的开头两句。"),
  tf(32, "“春眠不觉晓”的下一句是“处处闻啼鸟”。", "T",
    "出自孟浩然《春晓》。"),
  tf(33, "“欲穷千里目，更上一层楼”出自王之涣的《登鹳雀楼》。", "T",
    "全诗为“白日依山尽，黄河入海流……”。"),
  tf(34, "“独在异乡为异客，每逢佳节倍思亲”出自王维。", "T",
    "出自王维《九月九日忆山东兄弟》。"),
  tf(35, "“会当凌绝顶，一览众山小”描写的是泰山。", "T",
    "出自杜甫《望岳》，岳即东岳泰山。"),
  tf(36, "“海内存知己，天涯若比邻”出自王勃之手。", "T",
    "出自王勃《送杜少府之任蜀州》。"),
  tf(37, "“野火烧不尽，春风吹又生”出自白居易的诗。", "T",
    "出自白居易《赋得古原草送别》。"),
  tf(38, "“但愿人长久，千里共婵娟”中“婵娟”指的是月亮。", "T",
    "“婵娟”在此指代明月，出自苏轼《水调歌头》。"),
  tf(39, "“春蚕到死丝方尽，蜡炬成灰泪始干”出自李商隐的《无题》。", "T",
    "这是李商隐《无题·相见时难别亦难》中的名句。"),
  tf(40, "“忽如一夜春风来，千树万树梨花开”描写的是春天梨花盛开的景象。", "F",
    "诗句以梨花喻冬雪，描写的是边塞大雪后的壮丽雪景。"),
  // ---- 综合常识（41–50） ----
  tf(41, "地球绕太阳公转一周大约需要 365 天。", "T",
    "地球公转周期约为 365.24 天，即一年。"),
  tf(42, "在标准大气压下，水加热到 100℃ 会沸腾。", "T",
    "标准大气压下水的沸点是 100℃。"),
  tf(43, "中国的长城是世界上最长的人造建筑。", "T",
    "万里长城总长度超过两万千米。"),
  tf(44, "太阳系中离太阳最近的行星是金星。", "F",
    "离太阳最近的是水星，金星排第二。"),
  tf(45, "人体内最坚硬的组织是骨骼。", "F",
    "人体最坚硬的组织是牙釉质（珐琅质）。"),
  tf(46, "光在真空中的传播速度约为每秒 30 万千米。", "T",
    "光速约为 299,792 千米/秒，常取 30 万千米/秒。"),
  tf(47, "中华人民共和国的首都是北京。", "T", "北京是中国的首都。"),
  tf(48, "企鹅是一种会飞的鸟类。", "F", "企鹅属于鸟类但已失去飞行能力，擅长游泳。"),
  tf(49, "中国传统历法一年中有 24 个节气。", "T", "二十四节气是中国传统的季节划分。"),
  tf(50, "世界上面积最大的海洋是太平洋。", "T", "太平洋面积约占世界海洋总面积的一半。"),

  // ================= 二、单项选择（51–100） =================
  // ---- 技术常识（51–60，原题保留） ----
  single(51, "用户反馈页面白屏，第一步最应该做什么？",
    [
      ["A", "立即重写出问题的组件"],
      ["B", "复现问题并打开控制台查看报错"],
      ["C", "让用户换台电脑试试"],
      ["D", "先重启服务器碰碰运气"],
    ], "B", "先复现并依据控制台报错定位问题，排查应基于证据而不是猜测。"),
  single(52, "线上出现紧急 bug，最稳妥的处理方式是？",
    [
      ["A", "直接在 main 分支改完推送"],
      ["B", "拉热修分支，验证后尽快发布并复盘"],
      ["C", "假装没看见，等明天再说"],
      ["D", "不确认影响范围就回滚最近所有人的提交"],
    ], "B", "热修分支 + 验证 + 发布 + 事后复盘，既控制风险又能沉淀经验。"),
  single(53, "哪种做法最符合“避免阻塞浏览器主线程”？",
    [
      ["A", "页面加载时同步跑百万次循环计算"],
      ["B", "将耗时计算分片执行或放进 Web Worker"],
      ["C", "用 alert 提示用户耐心等待"],
      ["D", "插入更大的图片占位"],
    ], "B", "分片让出主线程或使用 Web Worker 在后台线程计算，页面才能保持流畅。"),
  single(54, "Code Review 时发现同事代码有个小问题，你会？",
    [
      ["A", "在群里公开吐槽"],
      ["B", "具体指出问题并给出修改建议"],
      ["C", "怕得罪人，直接点通过"],
      ["D", "不打招呼自己偷偷改掉"],
    ], "B", "对事不对人、具体且可执行的反馈才是有效的 Code Review。"),
  single(55, "接到一个需求但细节不明确，最符合的做法是？",
    [
      ["A", "完全按自己的猜测直接开工"],
      ["B", "先确认关键疑问点，再动手实现"],
      ["C", "搁置不做，等人来催"],
      ["D", "做出两版让用户自己猜要哪个"],
    ], "B", "先对齐需求再动工，能避免大量返工。"),
  single(56, "语义上用于“获取资源”的 HTTP 方法是？",
    [
      ["A", "POST"],
      ["B", "GET"],
      ["C", "DELETE"],
      ["D", "PUT"],
    ], "B", "GET 用于安全、幂等地获取资源；POST 提交、PUT 更新、DELETE 删除。"),
  single(57, "团队代码风格长期不统一，最治本的做法是？",
    [
      ["A", "每个人保持自己的风格"],
      ["B", "引入统一的 Linter / Formatter 配置并在提交时校验"],
      ["C", "只靠 Review 时口头提醒"],
      ["D", "复制粘贴别人的格式"],
    ], "B", "用工具自动化统一风格，比人工提醒稳定、成本更低。"),
  single(58, "API 密钥等敏感信息最应该放在哪里？",
    [
      ["A", "前端代码里写死"],
      ["B", "提交到公开的 Git 仓库"],
      ["C", "服务端环境变量或密钥管理服务"],
      ["D", "拼在 URL 查询参数里"],
    ], "C", "密钥必须保存在服务端且通过环境变量/密钥服务注入，前端代码和 URL 都可能被泄露。"),
  single(59, "关于写测试，最准确的说法是？",
    [
      ["A", "测试能证明程序完全没有 bug"],
      ["B", "测试用于提升改动信心、及时发现回归"],
      ["C", "测试只是为了应付流程"],
      ["D", "测试只会拖慢开发"],
    ], "B", "测试不能保证零 bug，但能在重构和迭代时显著降低回归风险。"),
  single(60, "面对几个不确定的技术方案，最符合的做法是？",
    [
      ["A", "凭感觉选一个"],
      ["B", "做小型 POC 对比后和团队一起决策"],
      ["C", "无限期调研，迟迟不落"],
      ["D", "只选网上最火的那个"],
    ], "B", "用最小成本的 POC 拿真实数据对比，再共同决策，兼顾效率与严谨。"),
  // ---- 简单数学（61–72） ----
  single(61, "计算：25 + 17 = ？",
    [["A", "42"], ["B", "41"], ["C", "43"], ["D", "52"]], "A", "25 + 17 = 42。"),
  single(62, "计算：9 × 7 = ？",
    [["A", "56"], ["B", "63"], ["C", "72"], ["D", "64"]], "B", "七九六十三。"),
  single(63, "计算：144 ÷ 12 = ？",
    [["A", "11"], ["B", "12"], ["C", "13"], ["D", "14"]], "B", "12 × 12 = 144，所以 144 ÷ 12 = 12。"),
  single(64, "计算：200 的 15% 是多少？",
    [["A", "15"], ["B", "30"], ["C", "45"], ["D", "20"]], "B", "200 × 0.15 = 30。"),
  single(65, "一个数加上 18 等于 45，这个数是？",
    [["A", "27"], ["B", "33"], ["C", "63"], ["D", "26"]], "A", "45 − 18 = 27。"),
  single(66, "一个长方形长 8、宽 5，它的周长是？",
    [["A", "13"], ["B", "26"], ["C", "40"], ["D", "18"]], "B", "周长 = (8 + 5) × 2 = 26。"),
  single(67, "任意三角形的内角和是多少度？",
    [["A", "90°"], ["B", "180°"], ["C", "270°"], ["D", "360°"]], "B", "三角形内角和恒为 180°。"),
  single(68, "小数 1.25 等于下面哪个分数？",
    [["A", "5/4"], ["B", "4/5"], ["C", "6/5"], ["D", "3/2"]], "A", "5 ÷ 4 = 1.25。"),
  single(69, "下面哪个数是质数？",
    [["A", "9"], ["B", "15"], ["C", "17"], ["D", "21"]], "C",
    "17 只能被 1 和它本身整除；9、15、21 都是合数。"),
  single(70, "3 点 30 分时，时针与分针之间较小的夹角是多少度？",
    [["A", "60°"], ["B", "75°"], ["C", "90°"], ["D", "105°"]], "B",
    "分针指向 6（180°），时针在 3 与 4 之间（105°），夹角为 75°。"),
  single(71, "找规律：2，4，8，16，（  ）",
    [["A", "20"], ["B", "24"], ["C", "32"], ["D", "64"]], "C", "后一个数是前一个的 2 倍，16 × 2 = 32。"),
  single(72, "下面四个数中最大的是？",
    [["A", "0.7"], ["B", "72%"], ["C", "3/4"], ["D", "0.69"]], "C",
    "统一成小数：0.7、0.72、0.75、0.69，最大的是 3/4。"),
  // ---- 文字 / 成语（73–82） ----
  single(73, "成语“守株待兔”主要比喻什么？",
    [
      ["A", "心存侥幸、妄想不劳而获"],
      ["B", "勤劳耕作终有收获"],
      ["C", "善于观察动物习性"],
      ["D", "做事要提前做好准备"],
    ], "A", "出自《韩非子》，讽刺死守经验、心存侥幸的人。"),
  single(74, "“画蛇添足”的意思与下列哪个成语最接近？",
    [["A", "锦上添花"], ["B", "多此一举"], ["C", "画龙点睛"], ["D", "精益求精"]], "B",
    "画蛇添足比喻做了多余的事，反而不恰当，即多此一举。"),
  single(75, "成语“卧薪尝胆”说的是哪位历史人物？",
    [["A", "夫差"], ["B", "范蠡"], ["C", "勾践"], ["D", "伍子胥"]], "C",
    "越王勾践败后卧薪尝胆、励精图治，最终灭吴。"),
  single(76, "“负荆请罪”中，背着荆条登门谢罪的人是？",
    [["A", "廉颇"], ["B", "蔺相如"], ["C", "赵括"], ["D", "白起"]], "A",
    "廉颇因误会蔺相如而负荆请罪，二人终成刎颈之交。"),
  single(77, "下列词语书写完全正确的一项是？",
    [["A", "焕然一新"], ["B", "换然一新"], ["C", "焕燃一新"], ["D", "换燃一新"]], "A",
    "“焕然一新”指呈现出崭新的面貌。"),
  single(78, "“床前明月光”中的“床”，较可信的解释之一是？",
    [
      ["A", "井上的围栏（井床）"],
      ["B", "睡觉用的床铺"],
      ["C", "窗户"],
      ["D", "椅子"],
    ], "A", "古来注家多认为“床”指井栏，诗人于户外井边见月生情。"),
  single(79, "“一日不见，如隔三秋”中的“三秋”指？",
    [
      ["A", "三年"],
      ["B", "三个季度（九个月）"],
      ["C", "三天"],
      ["D", "三十年"],
    ], "B", "一秋指一个季度（秋收时节），三秋即三个季度。"),
  single(80, "下列词语中属于形容词的是？",
    [["A", "美丽"], ["B", "跑步"], ["C", "我们"], ["D", "非常"]], "A",
    "“美丽”可以修饰名词，是形容词；“跑步”是动词，“我们”是代词，“非常”是副词。"),
  single(81, "“他的意见我基本完全同意”这句话的主要语病是？",
    [
      ["A", "成分残缺"],
      ["B", "前后矛盾"],
      ["C", "搭配不当"],
      ["D", "重复啰嗦但无矛盾"],
    ], "B", "“基本”与“完全”自相矛盾，应删去其一。"),
  single(82, "“少壮不努力”的下一句是？",
    [
      ["A", "老大徒伤悲"],
      ["B", "白首方悔读书迟"],
      ["C", "万事成蹉跎"],
      ["D", "一寸光阴一寸金"],
    ], "A", "出自汉乐府《长歌行》：“少壮不努力，老大徒伤悲。”"),
  // ---- 古诗词（83–92） ----
  single(83, "“锄禾日当午，汗滴禾下土”的作者是？",
    [["A", "李绅"], ["B", "白居易"], ["C", "杜甫"], ["D", "孟浩然"]], "A",
    "出自李绅《悯农》（其二）。"),
  single(84, "“举头望明月，低头思故乡”出自下列哪首诗？",
    [["A", "《春晓》"], ["B", "《静夜思》"], ["C", "《登鹳雀楼》"], ["D", "《望月怀远》"]], "B",
    "李白《静夜思》的结尾两句。"),
  single(85, "“两岸猿声啼不住”的下一句是？",
    [
      ["A", "唯见长江天际流"],
      ["B", "孤帆一片日边来"],
      ["C", "轻舟已过万重山"],
      ["D", "碧水东流至此回"],
    ], "C", "出自李白《早发白帝城》。"),
  single(86, "“停车坐爱枫林晚，霜叶红于二月花”中“坐”的意思是？",
    [["A", "坐下"], ["B", "因为"], ["C", "乘坐"], ["D", "徒然"]], "B",
    "“坐”在此处作“因为”讲，出自杜牧《山行》。"),
  single(87, "“不识庐山真面目，只缘身在此山中”的作者是？",
    [["A", "苏轼"], ["B", "王安石"], ["C", "陆游"], ["D", "欧阳修"]], "A",
    "出自苏轼《题西林壁》。"),
  single(88, "“人生自古谁无死，留取丹心照汗青”的作者是？",
    [["A", "岳飞"], ["B", "文天祥"], ["C", "陆游"], ["D", "辛弃疾"]], "B",
    "出自文天祥《过零丁洋》。"),
  single(89, "“随风潜入夜，润物细无声”描写的是什么？",
    [["A", "秋风"], ["B", "露水"], ["C", "春雨"], ["D", "小雪"]], "C",
    "出自杜甫《春夜喜雨》，写春雨夜里悄然滋润万物。"),
  single(90, "“接天莲叶无穷碧，映日荷花别样红”描写的是？",
    [
      ["A", "夏日西湖的荷花"],
      ["B", "秋日的菊花"],
      ["C", "春天的桃花"],
      ["D", "冬天的梅花"],
    ], "A", "出自杨万里《晓出净慈寺送林子方》，写六月西湖荷花。"),
  single(91, "“故人西辞黄鹤楼，烟花三月下扬州”中的“故人”是指？",
    [["A", "孟浩然"], ["B", "杜甫"], ["C", "王昌龄"], ["D", "元二"]], "A",
    "出自李白《黄鹤楼送孟浩然之广陵》，故人即孟浩然。"),
  single(92, "“莫愁前路无知己，天下谁人不识君”出自？",
    [
      ["A", "王维《送元二使安西》"],
      ["B", "李白《赠汪伦》"],
      ["C", "高适《别董大》"],
      ["D", "王勃《送杜少府之任蜀州》"],
    ], "C", "这是高适送别琴师董庭兰时所作《别董大》中的名句。"),
  // ---- 综合常识（93–100） ----
  single(93, "世界上海拔最高的山峰是？",
    [["A", "珠穆朗玛峰"], ["B", "乔戈里峰"], ["C", "乞力马扎罗山"], ["D", "富士山"]], "A",
    "珠穆朗玛峰海拔约 8848.86 米，为世界第一高峰。"),
  single(94, "下列哪一项不属于中国古代四大发明？",
    [["A", "造纸术"], ["B", "指南针"], ["C", "火药"], ["D", "地动仪"]], "D",
    "四大发明是造纸术、印刷术、指南针、火药；地动仪是张衡的发明。"),
  single(95, "地球上面积最大的大陆是？",
    [["A", "非洲大陆"], ["B", "亚欧大陆"], ["C", "北美大陆"], ["D", "南极大陆"]], "B",
    "亚欧大陆（欧亚大陆）是面积最大的大陆。"),
  single(96, "北半球一年中白昼时间最长的节气是？",
    [["A", "夏至"], ["B", "冬至"], ["C", "春分"], ["D", "秋分"]], "A",
    "夏至日太阳直射北回归线，北半球白昼最长。"),
  single(97, "空气里含量最多的气体是？",
    [["A", "氧气"], ["B", "氮气"], ["C", "二氧化碳"], ["D", "稀有气体"]], "B",
    "氮气约占空气体积的 78%，氧气约占 21%。"),
  single(98, "被后世尊称为“诗圣”的唐代诗人是？",
    [["A", "杜甫"], ["B", "李白"], ["C", "白居易"], ["D", "王维"]], "A",
    "李白被称为“诗仙”，杜甫被称为“诗圣”。"),
  single(99, "下列动物中属于哺乳动物的是？",
    [["A", "鲨鱼"], ["B", "鲸鱼"], ["C", "金鱼"], ["D", "鳄鱼"]], "B",
    "鲸鱼用肺呼吸、胎生哺乳，是哺乳动物；鲨鱼、金鱼是鱼，鳄鱼是爬行动物。"),
  single(100, "中国最长的河流是？",
    [["A", "长江"], ["B", "黄河"], ["C", "珠江"], ["D", "黑龙江"]], "A",
    "长江全长约 6300 千米，是中国第一长河。"),

  // ================= 三、图形点选（101–150） =================
  // ---- 纯色（101–110） ----
  graphic(101, "请点选【红色】的按钮", "red",
    "纯红色按钮，其余分别是蓝、绿、橙。",
    [
      colorOpt("blue", "#3b82f6", "蓝色按钮"),
      colorOpt("red", "#ef4444", "红色按钮"),
      colorOpt("green", "#22c55e", "绿色按钮"),
      colorOpt("orange", "#f97316", "橙色按钮"),
    ]),
  graphic(102, "请点选【黄色】的按钮", "yellow",
    "纯黄色按钮，其余为紫、粉、棕。",
    [
      colorOpt("purple", "#a855f7", "紫色按钮"),
      colorOpt("yellow", "#eab308", "黄色按钮"),
      colorOpt("pink", "#ec4899", "粉色按钮"),
      colorOpt("brown", "#92400e", "棕色按钮"),
    ]),
  graphic(103, "请点选【绿色】的按钮", "green",
    "纯绿色按钮，其余为橙、红、蓝。",
    [
      colorOpt("orange", "#f97316", "橙色按钮"),
      colorOpt("green", "#22c55e", "绿色按钮"),
      colorOpt("red", "#ef4444", "红色按钮"),
      colorOpt("blue", "#3b82f6", "蓝色按钮"),
    ]),
  graphic(104, "请点选【蓝色】的按钮", "blue",
    "纯蓝色按钮，其余为红、黄、绿。",
    [
      colorOpt("red", "#ef4444", "红色按钮"),
      colorOpt("yellow", "#eab308", "黄色按钮"),
      colorOpt("blue", "#3b82f6", "蓝色按钮"),
      colorOpt("green", "#22c55e", "绿色按钮"),
    ]),
  graphic(105, "请点选【紫色】的按钮", "purple",
    "纯紫色按钮，其余为橙、绿、红。",
    [
      colorOpt("orange", "#f97316", "橙色按钮"),
      colorOpt("green", "#22c55e", "绿色按钮"),
      colorOpt("purple", "#a855f7", "紫色按钮"),
      colorOpt("red", "#ef4444", "红色按钮"),
    ]),
  graphic(106, "请点选【粉色】的按钮", "pink",
    "纯粉色按钮，其余为蓝、黄、绿。",
    [
      colorOpt("pink", "#ec4899", "粉色按钮"),
      colorOpt("blue", "#3b82f6", "蓝色按钮"),
      colorOpt("yellow", "#eab308", "黄色按钮"),
      colorOpt("green", "#22c55e", "绿色按钮"),
    ]),
  graphic(107, "请点选【橙色】的按钮", "orange",
    "纯橙色按钮，其余为紫、青、灰。",
    [
      colorOpt("purple", "#a855f7", "紫色按钮"),
      colorOpt("orange", "#f97316", "橙色按钮"),
      colorOpt("teal", "#14b8a6", "青色按钮"),
      colorOpt("gray", "#6b7280", "灰色按钮"),
    ]),
  graphic(108, "请点选【青色】的按钮", "teal",
    "纯青色（湖绿）按钮，其余为红、黄、粉。",
    [
      colorOpt("teal", "#14b8a6", "青色按钮"),
      colorOpt("red", "#ef4444", "红色按钮"),
      colorOpt("yellow", "#eab308", "黄色按钮"),
      colorOpt("pink", "#ec4899", "粉色按钮"),
    ]),
  graphic(109, "请点选【灰色】的按钮", "gray",
    "纯灰色按钮，其余为棕、橙、黄。",
    [
      colorOpt("brown", "#92400e", "棕色按钮"),
      colorOpt("orange", "#f97316", "橙色按钮"),
      colorOpt("gray", "#6b7280", "灰色按钮"),
      colorOpt("yellow", "#eab308", "黄色按钮"),
    ]),
  graphic(110, "请点选【棕色】的按钮", "brown",
    "纯棕色按钮，其余为红、蓝、绿。",
    [
      colorOpt("brown", "#92400e", "棕色按钮"),
      colorOpt("red", "#ef4444", "红色按钮"),
      colorOpt("blue", "#3b82f6", "蓝色按钮"),
      colorOpt("green", "#22c55e", "绿色按钮"),
    ]),
  // ---- 动物 / 表情 emoji（111–115） ----
  graphic(111, "请点选带有 🐱 的按钮", "cat",
    "目标图案是猫 🐱，其余为狗、兔、熊。",
    [
      emojiOpt("dog", "🐶"),
      emojiOpt("cat", "🐱"),
      emojiOpt("rabbit", "🐰"),
      emojiOpt("bear", "🐻"),
    ]),
  graphic(112, "请点选带有 🐯 的按钮", "tiger",
    "目标图案是老虎 🐯，其余为青蛙、狮子、猪。",
    [
      emojiOpt("frog", "🐸"),
      emojiOpt("lion", "🦁"),
      emojiOpt("pig", "🐷"),
      emojiOpt("tiger", "🐯"),
    ]),
  graphic(113, "请点选带有 🐼 的按钮", "panda",
    "目标图案是熊猫 🐼，其余为考拉、狐狸、奶牛。",
    [
      emojiOpt("koala", "🐨"),
      emojiOpt("fox", "🦊"),
      emojiOpt("cow", "🐮"),
      emojiOpt("panda", "🐼"),
    ]),
  graphic(114, "请点选带有 🐵 的按钮", "monkey",
    "目标图案是猴子 🐵，其余为鸡、企鹅、独角兽。",
    [
      emojiOpt("chicken", "🐔"),
      emojiOpt("penguin", "🐧"),
      emojiOpt("unicorn", "🦄"),
      emojiOpt("monkey", "🐵"),
    ]),
  graphic(115, "请点选带有 🐢 的按钮", "turtle",
    "目标图案是乌龟 🐢，其余为章鱼、螃蟹、海豚。",
    [
      emojiOpt("octopus", "🐙"),
      emojiOpt("crab", "🦀"),
      emojiOpt("dolphin", "🐬"),
      emojiOpt("turtle", "🐢"),
    ]),
  // ---- 物品 / 符号 emoji（116–124） ----
  graphic(116, "请点选带有 🎯 的按钮", "target",
    "目标图案是靶心 🎯。",
    [
      emojiOpt("basketball", "🏀"),
      emojiOpt("target", "🎯"),
      emojiOpt("dice", "🎲"),
      emojiOpt("palette", "🎨"),
    ]),
  graphic(117, "请点选【红色的心】❤️", "red-heart",
    "四颗心形形状相同、颜色不同，红色的才是目标。",
    [
      emojiOpt("orange-heart", "🧡", "橙色的心 🧡"),
      emojiOpt("yellow-heart", "💛", "黄色的心 💛"),
      emojiOpt("green-heart", "💚", "绿色的心 💚"),
      emojiOpt("red-heart", "❤️", "红色的心 ❤️"),
    ]),
  graphic(118, "请点选带有 🌸 的按钮", "blossom",
    "目标图案是樱花 🌸，其余为仙人掌、枫叶、苹果。",
    [
      emojiOpt("cactus", "🌵"),
      emojiOpt("maple", "🍁"),
      emojiOpt("apple", "🍎"),
      emojiOpt("blossom", "🌸"),
    ]),
  graphic(119, "请点选带有 🚗 的按钮", "car",
    "目标图案是小汽车 🚗，其余为自行车、飞机、轮船。",
    [
      emojiOpt("bike", "🚲"),
      emojiOpt("plane", "✈️"),
      emojiOpt("ship", "🚢"),
      emojiOpt("car", "🚗"),
    ]),
  graphic(120, "请点选带有 🍎 的按钮", "apple",
    "目标图案是苹果 🍎，其余为香蕉、葡萄、草莓。",
    [
      emojiOpt("banana", "🍌"),
      emojiOpt("grapes", "🍇"),
      emojiOpt("strawberry", "🍓"),
      emojiOpt("apple", "🍎"),
    ]),
  graphic(121, "请点选带有 ⭐ 的按钮", "star-emoji",
    "目标图案是星星 ⭐，其余为月亮、太阳、闪电。",
    [
      emojiOpt("moon", "🌙"),
      emojiOpt("sun", "☀️"),
      emojiOpt("bolt", "⚡"),
      emojiOpt("star-emoji", "⭐"),
    ]),
  graphic(122, "请点选带有 👍 的按钮", "thumbsup",
    "目标图案是竖起大拇指 👍，其余为拇指朝下、鼓掌、举手。",
    [
      emojiOpt("thumbsdown", "👎"),
      emojiOpt("clap", "👏"),
      emojiOpt("handsup", "🙌"),
      emojiOpt("thumbsup", "👍"),
    ]),
  graphic(123, "请点选带有 🎵 的按钮", "note",
    "目标图案是音符 🎵，其余为吉他、鼓、小号。",
    [
      emojiOpt("guitar", "🎸"),
      emojiOpt("drum", "🥁"),
      emojiOpt("trumpet", "🎺"),
      emojiOpt("note", "🎵"),
    ]),
  graphic(124, "请点选带有 🔑 的按钮", "key",
    "目标图案是钥匙 🔑，其余为锁、铃铛、闹钟。",
    [
      emojiOpt("lock", "🔒"),
      emojiOpt("bell", "🔔"),
      emojiOpt("alarm", "⏰"),
      emojiOpt("key", "🔑"),
    ]),
  // ---- 几何形状（125–134） ----
  graphic(125, "请点选【三角形】", "triangle",
    "三角形有三条边、三个顶点。",
    [
      shapeOpt("square", "square", "#6366f1", "方块 ■"),
      shapeOpt("circle", "circle", "#6366f1", "圆形 ●"),
      shapeOpt("triangle", "triangle", "#6366f1", "三角形 ▲"),
      shapeOpt("star", "star", "#6366f1", "星形 ★"),
    ]),
  graphic(126, "请点选【五角星】", "star",
    "五角星有五个向外突出的尖角。",
    [
      shapeOpt("triangle", "triangle", "#f59e0b", "三角形 ▲", 58),
      shapeOpt("pentagon", "pentagon", "#f59e0b", "五边形 ⬠", 58),
      shapeOpt("star", "star", "#f59e0b", "五角星 ★", 58),
      shapeOpt("hexagon", "hexagon", "#f59e0b", "六边形 ⬡", 58),
    ]),
  graphic(127, "请点选【正方形】", "square",
    "正方形四条边等长、四个角都是直角。",
    [
      shapeOpt("circle", "circle", "#14b8a6", "圆形 ●"),
      shapeOpt("square", "square", "#14b8a6", "正方形 ■"),
      shapeOpt("triangle", "triangle", "#14b8a6", "三角形 ▲"),
      shapeOpt("hexagon", "hexagon", "#14b8a6", "六边形 ⬡"),
    ]),
  graphic(128, "请点选【圆形】", "circle",
    "圆形边缘完全由弧线构成，没有角。",
    [
      shapeOpt("square", "square", "#ec4899", "正方形 ■"),
      shapeOpt("circle", "circle", "#ec4899", "圆形 ●"),
      shapeOpt("pentagon", "pentagon", "#ec4899", "五边形 ⬠"),
      shapeOpt("triangle", "triangle", "#ec4899", "三角形 ▲"),
    ]),
  graphic(129, "请点选【六边形】", "hexagon",
    "六边形有六条边、六个顶点。",
    [
      shapeOpt("triangle", "triangle", "#8b5cf6", "三角形 ▲"),
      shapeOpt("star", "star", "#8b5cf6", "五角星 ★"),
      shapeOpt("pentagon", "pentagon", "#8b5cf6", "五边形 ⬠"),
      shapeOpt("hexagon", "hexagon", "#8b5cf6", "六边形 ⬡"),
    ]),
  graphic(130, "请点选【五边形】", "pentagon",
    "五边形有五条边、五个顶点。",
    [
      shapeOpt("pentagon", "pentagon", "#0ea5e9", "五边形 ⬠"),
      shapeOpt("square", "square", "#0ea5e9", "正方形 ■"),
      shapeOpt("hexagon", "hexagon", "#0ea5e9", "六边形 ⬡"),
      shapeOpt("circle", "circle", "#0ea5e9", "圆形 ●"),
    ]),
  graphic(131, "请点选【绿色的圆形】", "green-circle",
    "需要同时满足“绿色”和“圆形”两个条件。",
    [
      shapeOpt("red-circle", "circle", "#ef4444", "红色圆形"),
      shapeOpt("green-square", "square", "#22c55e", "绿色方块"),
      shapeOpt("green-circle", "circle", "#22c55e", "绿色圆形"),
      shapeOpt("blue-circle", "circle", "#3b82f6", "蓝色圆形"),
    ]),
  graphic(132, "请点选【蓝色的正方形】", "blue-square",
    "需要同时满足“蓝色”和“正方形”两个条件。",
    [
      shapeOpt("blue-circle", "circle", "#3b82f6", "蓝色圆形"),
      shapeOpt("red-square", "square", "#ef4444", "红色正方形"),
      shapeOpt("blue-square", "square", "#3b82f6", "蓝色正方形"),
      shapeOpt("green-square", "square", "#22c55e", "绿色正方形"),
    ]),
  graphic(133, "请点选【红色的三角形】", "red-triangle",
    "需要同时满足“红色”和“三角形”两个条件。",
    [
      shapeOpt("blue-triangle", "triangle", "#3b82f6", "蓝色三角形"),
      shapeOpt("red-square", "square", "#ef4444", "红色正方形"),
      shapeOpt("red-triangle", "triangle", "#ef4444", "红色三角形 ▲"),
      shapeOpt("red-circle", "circle", "#ef4444", "红色圆形"),
    ]),
  graphic(134, "请点选【黄色的五角星】", "yellow-star",
    "需要同时满足“黄色”和“五角星”两个条件。",
    [
      shapeOpt("yellow-triangle", "triangle", "#eab308", "黄色三角形 ▲"),
      shapeOpt("blue-star", "star", "#3b82f6", "蓝色五角星 ★"),
      shapeOpt("yellow-square", "square", "#eab308", "黄色正方形 ■"),
      shapeOpt("yellow-star", "star", "#eab308", "黄色五角星 ★"),
    ]),
  // ---- 大小对比（135–138） ----
  graphic(135, "请点选【最大的】圆形", "size-56",
    "四个圆形同为深色，边长 56px 的那个最大。",
    [
      shapeOpt("size-24", "circle", "#0ea5e9", "圆形（24px）", 24),
      shapeOpt("size-40", "circle", "#0ea5e9", "圆形（40px）", 40),
      shapeOpt("size-56", "circle", "#0ea5e9", "最大的圆形（56px）", 56),
      shapeOpt("size-32", "circle", "#0ea5e9", "圆形（32px）", 32),
    ]),
  graphic(136, "请点选【最小的】正方形", "mini-24",
    "四个正方形同为紫色，边长 24px 的那个最小。",
    [
      shapeOpt("mini-24", "square", "#8b5cf6", "最小的正方形（24px）", 24),
      shapeOpt("mid-36", "square", "#8b5cf6", "正方形（36px）", 36),
      shapeOpt("mid-44", "square", "#8b5cf6", "正方形（44px）", 44),
      shapeOpt("big-56", "square", "#8b5cf6", "正方形（56px）", 56),
    ]),
  graphic(137, "请点选【最大的】三角形", "tri-52",
    "四个三角形同为红色，边长 52px 的那个最大。",
    [
      shapeOpt("tri-28", "triangle", "#ef4444", "三角形（28px）", 28),
      shapeOpt("tri-36", "triangle", "#ef4444", "三角形（36px）", 36),
      shapeOpt("tri-44", "triangle", "#ef4444", "三角形（44px）", 44),
      shapeOpt("tri-52", "triangle", "#ef4444", "最大的三角形（52px）", 52),
    ]),
  graphic(138, "请点选【最大的】五角星", "star-56",
    "四颗五角星同为金色，边长 56px 的那颗最大。",
    [
      shapeOpt("star-24", "star", "#eab308", "五角星（24px）", 24),
      shapeOpt("star-40", "star", "#eab308", "五角星（40px）", 40),
      shapeOpt("star-56", "star", "#eab308", "最大的五角星（56px）", 56),
      shapeOpt("star-32", "star", "#eab308", "五角星（32px）", 32),
    ]),
  // ---- 更多颜色组合 / emoji / 形状（139–150） ----
  graphic(139, "请点选【紫色的圆形】", "purple-circle",
    "需要同时满足“紫色”和“圆形”两个条件。",
    [
      shapeOpt("purple-square", "square", "#a855f7", "紫色正方形"),
      shapeOpt("purple-circle", "circle", "#a855f7", "紫色圆形"),
      shapeOpt("green-circle", "circle", "#22c55e", "绿色圆形"),
      shapeOpt("orange-circle", "circle", "#f97316", "橙色圆形"),
    ]),
  graphic(140, "请点选【绿色的三角形】", "green-triangle",
    "需要同时满足“绿色”和“三角形”两个条件。",
    [
      shapeOpt("green-triangle", "triangle", "#22c55e", "绿色三角形 ▲"),
      shapeOpt("green-circle", "circle", "#22c55e", "绿色圆形"),
      shapeOpt("red-triangle", "triangle", "#ef4444", "红色三角形 ▲"),
      shapeOpt("blue-square", "square", "#3b82f6", "蓝色正方形"),
    ]),
  graphic(141, "请点选【橙色的正方形】", "orange-square",
    "需要同时满足“橙色”和“正方形”两个条件。",
    [
      shapeOpt("orange-circle", "circle", "#f97316", "橙色圆形"),
      shapeOpt("yellow-square", "square", "#eab308", "黄色正方形"),
      shapeOpt("red-square", "square", "#ef4444", "红色正方形"),
      shapeOpt("orange-square", "square", "#f97316", "橙色正方形"),
    ]),
  graphic(142, "请点选【粉色的五角星】", "pink-star",
    "需要同时满足“粉色”和“五角星”两个条件。",
    [
      shapeOpt("pink-circle", "circle", "#ec4899", "粉色圆形"),
      shapeOpt("purple-star", "star", "#a855f7", "紫色五角星 ★"),
      shapeOpt("pink-triangle", "triangle", "#ec4899", "粉色三角形 ▲"),
      shapeOpt("pink-star", "star", "#ec4899", "粉色五角星 ★"),
    ]),
  graphic(143, "请点选带有 🐶 的按钮", "dog",
    "目标图案是狗 🐶，其余为猫、兔、熊。",
    [
      emojiOpt("cat", "🐱"),
      emojiOpt("rabbit", "🐰"),
      emojiOpt("bear", "🐻"),
      emojiOpt("dog", "🐶"),
    ]),
  graphic(144, "请点选带有 🌙 的按钮", "moon",
    "目标图案是弯月 🌙，其余为星星、太阳、闪电。",
    [
      emojiOpt("star-emoji", "⭐"),
      emojiOpt("sun", "☀️"),
      emojiOpt("bolt", "⚡"),
      emojiOpt("moon", "🌙"),
    ]),
  graphic(145, "请点选带有 🍓 的按钮", "strawberry",
    "目标图案是草莓 🍓，其余为苹果、橘子、西瓜。",
    [
      emojiOpt("apple", "🍎"),
      emojiOpt("tangerine", "🍊"),
      emojiOpt("watermelon", "🍉"),
      emojiOpt("strawberry", "🍓"),
    ]),
  graphic(146, "请点选带有 ⚽ 的按钮", "soccer",
    "目标图案是足球 ⚽，其余为篮球、网球、排球。",
    [
      emojiOpt("basketball", "🏀"),
      emojiOpt("tennis", "🎾"),
      emojiOpt("soccer", "⚽"),
      emojiOpt("volleyball", "🏐"),
    ]),
  graphic(147, "请点选带有 🌈 的按钮", "rainbow",
    "目标图案是彩虹 🌈，其余为云、雨、雪。",
    [
      emojiOpt("cloud", "☁️"),
      emojiOpt("rain", "🌧️"),
      emojiOpt("snow", "❄️"),
      emojiOpt("rainbow", "🌈"),
    ]),
  graphic(148, "请点选带有 🎈 的按钮", "balloon",
    "目标图案是气球 🎈，其余为礼物盒、彩炮、礼花球。",
    [
      emojiOpt("gift", "🎁"),
      emojiOpt("confetti", "🎉"),
      emojiOpt("firework-ball", "🎊"),
      emojiOpt("balloon", "🎈"),
    ]),
  graphic(149, "请点选【星形】图案", "plain-star",
    "星形有五个向外突出的尖角。",
    [
      shapeOpt("square", "square", "#14b8a6", "方块 ■"),
      shapeOpt("pentagon", "pentagon", "#14b8a6", "五边形 ⬠"),
      shapeOpt("plain-star", "star", "#14b8a6", "星形 ★"),
      shapeOpt("hexagon", "hexagon", "#14b8a6", "六边形 ⬡"),
    ]),
  graphic(150, "请点选【红色的圆形】", "red-circle",
    "需要同时满足“红色”和“圆形”两个条件。",
    [
      shapeOpt("blue-circle", "circle", "#3b82f6", "蓝色圆形"),
      shapeOpt("red-square", "square", "#ef4444", "红色正方形"),
      shapeOpt("red-triangle", "triangle", "#ef4444", "红色三角形 ▲"),
      shapeOpt("red-circle", "circle", "#ef4444", "红色圆形"),
    ]),

  // ================= 四、滑块移动（151–160） =================
  sliderQ(151, "请将滑块精确移动到【37】", { min: 0, max: 100, step: 1, target: 37 },
    "目标位置是 37，停在正中间（50）附近不算对哦。"),
  sliderQ(152, "请将滑块精确移动到【7】", { min: 0, max: 10, step: 1, target: 7 },
    "范围 0–10，目标位置是 7。"),
  sliderQ(153, "请将滑块精确移动到【25】", { min: 0, max: 100, step: 1, target: 25 },
    "目标位置是 25，也就是量程的四分之一处。"),
  sliderQ(154, "请将滑块精确移动到【3】", { min: 1, max: 5, step: 1, target: 3 },
    "范围 1–5，正中间是 3。"),
  sliderQ(155, "请将滑块精确移动到【80】", { min: 0, max: 100, step: 1, target: 80 },
    "目标位置是 80，靠近量程右端。"),
  sliderQ(156, "请将滑块精确移动到【15】", { min: 0, max: 30, step: 1, target: 15 },
    "范围 0–30，正中间是 15。"),
  sliderQ(157, "请将滑块移动到最左端【0】", { min: 0, max: 100, step: 1, target: 0 },
    "最左端是起点 0。"),
  sliderQ(158, "请将滑块移动到最右端【100】", {  min: 0, max: 100, step: 1, target: 100 },
    "最右端是终点 100。"),
  sliderQ(159, "请将滑块精确移动到【6】", { min: 1, max: 12, step: 1, target: 6 },
    "范围 1–12，目标位置是 6。"),
  sliderQ(160, "请将滑块精确移动到【64】", { min: 0, max: 100, step: 1, target: 64 },
    "目标位置是 64，可以用键盘方向键微调。"),

  // ================= 五、人机交互检测 · 长按（161–170） =================
  longpressQ(161, "【红色】", "red", [
    colorOpt("blue", "#3b82f6", "蓝色按钮"),
    colorOpt("red", "#ef4444", "红色按钮"),
    colorOpt("green", "#22c55e", "绿色按钮"),
    colorOpt("orange", "#f97316", "橙色按钮"),
  ]),
  longpressQ(162, "【黄色】", "yellow", [
    colorOpt("purple", "#a855f7", "紫色按钮"),
    colorOpt("yellow", "#eab308", "黄色按钮"),
    colorOpt("pink", "#ec4899", "粉色按钮"),
    colorOpt("brown", "#92400e", "棕色按钮"),
  ]),
  longpressQ(163, "【绿色】", "green", [
    colorOpt("orange", "#f97316", "橙色按钮"),
    colorOpt("green", "#22c55e", "绿色按钮"),
    colorOpt("red", "#ef4444", "红色按钮"),
    colorOpt("blue", "#3b82f6", "蓝色按钮"),
  ]),
  longpressQ(164, "【蓝色】", "blue", [
    colorOpt("red", "#ef4444", "红色按钮"),
    colorOpt("yellow", "#eab308", "黄色按钮"),
    colorOpt("blue", "#3b82f6", "蓝色按钮"),
    colorOpt("green", "#22c55e", "绿色按钮"),
  ]),
  longpressQ(165, "【紫色】", "purple", [
    colorOpt("orange", "#f97316", "橙色按钮"),
    colorOpt("green", "#22c55e", "绿色按钮"),
    colorOpt("purple", "#a855f7", "紫色按钮"),
    colorOpt("red", "#ef4444", "红色按钮"),
  ]),
  longpressQ(166, "【粉色】", "pink", [
    colorOpt("pink", "#ec4899", "粉色按钮"),
    colorOpt("blue", "#3b82f6", "蓝色按钮"),
    colorOpt("yellow", "#eab308", "黄色按钮"),
    colorOpt("green", "#22c55e", "绿色按钮"),
  ]),
  longpressQ(167, "【橙色】", "orange", [
    colorOpt("purple", "#a855f7", "紫色按钮"),
    colorOpt("orange", "#f97316", "橙色按钮"),
    colorOpt("teal", "#14b8a6", "青色按钮"),
    colorOpt("gray", "#6b7280", "灰色按钮"),
  ]),
  longpressQ(168, "【青色】", "teal", [
    colorOpt("teal", "#14b8a6", "青色按钮"),
    colorOpt("red", "#ef4444", "红色按钮"),
    colorOpt("yellow", "#eab308", "黄色按钮"),
    colorOpt("pink", "#ec4899", "粉色按钮"),
  ]),
  longpressQ(169, "【灰色】", "gray", [
    colorOpt("brown", "#92400e", "棕色按钮"),
    colorOpt("orange", "#f97316", "橙色按钮"),
    colorOpt("gray", "#6b7280", "灰色按钮"),
    colorOpt("yellow", "#eab308", "黄色按钮"),
  ]),
  longpressQ(170, "【棕色】", "brown", [
    colorOpt("brown", "#92400e", "棕色按钮"),
    colorOpt("red", "#ef4444", "红色按钮"),
    colorOpt("blue", "#3b82f6", "蓝色按钮"),
    colorOpt("green", "#22c55e", "绿色按钮"),
  ]),

  // ================= 六、人机交互检测 · 拼图验证码（171–175） =================
  puzzleQ(171, "把下方托盘里的【拼图块】拖到图片中虚线缺口的位置，让图片完整对上来",
    {
      scene: { from: "#fb923c", to: "#7c3aed", accent: "#fde68a", accentX: 0.28, accentY: 0.3, accentR: 0.34 },
      gapX: 0.68,
      gapY: 0.42,
      tolerance: 0.05,
    },
    "拼图块要落在虚线缺口中心附近，偏差过大（超出容差）就算没对齐。"),
  puzzleQ(172, "把这张图缺失的【拼图块】拖动回原位，补全图片",
    {
      scene: { from: "#38bdf8", to: "#1e3a8a", accent: "#bae6fd", accentX: 0.7, accentY: 0.26, accentR: 0.3 },
      gapX: 0.32,
      gapY: 0.58,
      tolerance: 0.045,
    },
    "缺口在图片左下方，注意纵横比例：横向 32%、纵向 58% 处。"),
  puzzleQ(173, "把下方的【缺失图块】移动到图片里对应的空位上",
    {
      scene: { from: "#4ade80", to: "#065f46", accent: "#bbf7d0", accentX: 0.5, accentY: 0.72, accentR: 0.38 },
      gapX: 0.55,
      gapY: 0.35,
      tolerance: 0.05,
    },
    "松手时图块中心要落在缺口内，缺口的边缘能对齐上。"),
  puzzleQ(174, "把【拼图块】移动到图片中缺图的位置，补全这张图",
    {
      scene: { from: "#f472b6", to: "#4c1d95", accent: "#fbcfe8", accentX: 0.24, accentY: 0.66, accentR: 0.32 },
      gapX: 0.25,
      gapY: 0.4,
      tolerance: 0.045,
    },
    "缺口靠图片左侧，位置大致是横向 25%、纵向 40%。"),
  puzzleQ(175, "把这张图缺的那一格【拖回去】，让图案接上",
    {
      scene: { from: "#fcd34d", to: "#b45309", accent: "#fff7ed", accentX: 0.78, accentY: 0.68, accentR: 0.3 },
      gapX: 0.72,
      gapY: 0.62,
      tolerance: 0.05,
    },
    "缺口在图片右下区域，落在容差范围内即算对齐。"),
];

export const POINTS_PER_QUESTION = 5;
/** 题库总题数（满分按题库总量计算，仅用于展示题库规模） */
export const BANK_SIZE = QUESTIONS.length;
/** 每次测验抽题数量 */
export const QUIZ_SIZE = 30;
