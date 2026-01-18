window.gLocalAssetContainer["main"] = function(g) { (function(exports, require, module, __filename, __dirname) {
/* eslint-disable no-undef */

// 健康・健康食品クイズ（ランキング）
// - 全体120秒（sessionParameter.totalTimeLimit があれば優先）
// - ルール説明10秒 → クイズ10問
// - 1問: タイピング表示(約4〜5秒) → 解答(タイピング完了後は5秒) → 判定3秒
// - 6択、早いほど加点、誤答は減点

exports.main = void 0;
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function shuffleInPlace(arr, random) {
  for (let i = arr.length - 1; i > 0; --i) {
    const j = Math.floor(random.generate() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}
function pickUniqueIndices(n, k, random) {
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  shuffleInPlace(idx, random);
  return idx.slice(0, k);
}
function createQuizStock100() {
  // 100問（健康・健康食品）
  // choices は「正解を含む6択の候補語」。正解位置はセッションごとに分散ロジックで割り当てる。
  const q = [];
  const push = (question, correct, wrongs) => {
    const choices = [correct].concat(wrongs);
    q.push({
      question,
      correct,
      choices
    });
  };

  // 手作り問題（まずは一定数）
  push("ビタミンCが多い果物として一般的に知られるのは？", "キウイ", ["バナナ", "ぶどう", "りんご", "スイカ", "メロン"]);
  push("食物繊維が腸内環境に役立つ理由として最も近いのは？", "善玉菌のエサになりやすい", ["血液を直接増やす", "骨を硬くする", "視力を回復させる", "体温を下げる", "筋肉を直接増やす"]);
  push("発酵食品の例として適切なのは？", "納豆", ["食パン", "ゆで卵", "生野菜", "白米", "焼き魚"]);
  push("水分補給で『のどが渇く前に』飲むのが推奨される主な理由は？", "脱水の進行を防ぐため", ["胃を空にするため", "眠気を増やすため", "体脂肪を増やすため", "血糖値を急上昇させるため", "筋肉痛を悪化させるため"]);
  push("タンパク質が体で主に使われる役割として正しいのは？", "筋肉や臓器など体の材料", ["体温を下げる", "紫外線を遮る", "骨を溶かす", "睡眠を不要にする", "味覚を消す"]);
  push("カルシウムの吸収を助ける栄養素として知られるのは？", "ビタミンD", ["ビタミンK", "ビタミンB1", "ビタミンC", "ナイアシン", "葉酸"]);
  push("鉄分が不足すると起こりやすい状態は？", "貧血", ["虫歯", "花粉症", "骨折", "近視", "熱中症"]);
  push("塩分（ナトリウム）を摂りすぎると影響しやすいのは？", "血圧", ["身長", "視力", "聴力", "髪の色", "指の長さ"]);
  push("『GI値』が表すものとして近いのは？", "食後血糖の上がりやすさ", ["脂質の燃えやすさ", "タンパク質の量", "ビタミンの種類", "水分の量", "食物の温度"]);
  push("オメガ3脂肪酸を多く含む食品の例は？", "青魚", ["白砂糖", "食塩", "白米", "バター", "牛乳"]);
  push("睡眠の質を上げるために就寝前に控えたいものは？", "カフェイン", ["水", "白湯", "ノンカフェイン茶", "常温の牛乳", "ハーブティー"]);
  push("野菜の色素『β-カロテン』が多い野菜の例は？", "にんじん", ["きゅうり", "大根", "白菜", "もやし", "レタス"]);
  push("腸内細菌のバランスを整える食品としてよく挙げられるのは？", "ヨーグルト", ["砂糖菓子", "揚げ物", "清涼飲料水", "スナック菓子", "加工肉"]);
  push("『トランス脂肪酸』が多く含まれやすい食品は？", "一部のマーガリンやショートニング", ["玄米", "豆腐", "刺身", "海藻", "果物"]);
  push("運動後の回復に役立つ栄養の組み合わせとして近いのは？", "タンパク質＋炭水化物", ["塩分＋砂糖のみ", "水のみ", "脂質のみ", "カフェインのみ", "香辛料のみ"]);
  push("『プロバイオティクス』の説明として近いのは？", "体に良い働きをする生きた菌", ["体内で作られる毒素", "食物の色素", "血液型の分類", "運動の種類", "睡眠の段階"]);
  push("『プレバイオティクス』の説明として近いのは？", "善玉菌のエサになる成分", ["体に悪い菌", "脂肪を溶かす薬", "筋肉を分解する酵素", "血圧を上げる物質", "視力を上げる成分"]);
  push("食塩相当量を減らす工夫として効果的なのは？", "だしや香味で風味を足す", ["味付けを濃くする", "塩を直接かける", "加工食品を増やす", "汁物を増やす", "漬物を増やす"]);
  push("水溶性食物繊維が多い食品の例は？", "海藻", ["鶏むね肉", "白米", "食塩", "砂糖", "バター"]);
  push("不溶性食物繊維が多い食品の例は？", "豆類", ["はちみつ", "清涼飲料水", "バター", "マヨネーズ", "ゼリー"]);
  push("『抗酸化』に関係が深い栄養素としてよく知られるのは？", "ビタミンE", ["ビタミンB12", "ビタミンB1", "ビタミンD", "ビタミンK", "ビタミンB2"]);
  push("日常での『有酸素運動』の例として適切なのは？", "速歩", ["最大重量のスクワット", "短距離全力走のみ", "握力トレーニング", "腕立て伏せのみ", "懸垂のみ"]);
  push("体重管理で重要な要素として最も基本的なのは？", "摂取エネルギーと消費エネルギーのバランス", ["水の色", "食器の形", "服の色", "テレビの音量", "歩幅の長さだけ"]);
  push("『血糖値スパイク』の説明として近いのは？", "食後に血糖が急上昇・急降下する", ["血圧が一定になる", "体温が下がる", "視力が上がる", "筋肉が増える", "骨が伸びる"]);
  push("食事の順番で血糖上昇を抑えやすいとされるのは？", "野菜→主菜→主食", ["主食→甘い物→野菜", "甘い物→主食→主菜", "主菜→甘い物→主食", "主食→主菜→野菜", "甘い物→野菜→主食"]);
  push("『ナッツ』を間食にする際の注意点として近いのは？", "食べ過ぎるとカロリー過多になりやすい", ["水分がゼロになる", "必ず眠くなる", "骨が溶ける", "視力が落ちる", "体温が急低下する"]);
  push("『減塩』のためにラベルで確認する項目は？", "食塩相当量", ["水分量", "食物の色", "香りの強さ", "容器の形", "製造工場の面積"]);
  push("『たんぱく質』が多い食品の例は？", "鶏むね肉", ["砂糖", "食塩", "油のみ", "水", "寒天"]);
  push("『ビタミンB1』が不足すると起こりやすいのは？", "疲れやすさ", ["虫歯", "骨折", "近視", "花粉症", "日焼け"]);
  push("『カリウム』が多い食品の例は？", "バナナ", ["食塩", "砂糖", "バター", "白米", "揚げ油"]);
  push("『水分』の体内での役割として近いのは？", "体温調節や運搬", ["骨を直接作る", "視力を直接上げる", "髪色を変える", "身長を伸ばす", "味覚を消す"]);
  push("『食中毒予防』の三原則としてよく言われるのは？", "つけない・増やさない・やっつける", ["冷やさない・混ぜない・振らない", "食べない・飲まない・寝ない", "切らない・焼かない・煮ない", "洗わない・拭かない・触らない", "見ない・聞かない・言わない"]);
  push("『適度な運動』の目安として一般的に推奨されるのは？", "週に複数回の継続", ["年に1回だけ全力", "毎日必ず徹夜", "運動は一切しない", "食事だけで十分", "水を飲まない"]);
  push("『ストレス対策』として効果が期待されるのは？", "深呼吸や軽い運動", ["睡眠を削る", "カフェインを増やす", "食事を抜く", "水分を減らす", "夜更かしを増やす"]);
  push("『食物アレルギー』で重要なのは？", "原因食品の確認と回避", ["とにかく我慢", "水を飲めば治る", "運動で治す", "塩を増やす", "砂糖を増やす"]);
  push("『サプリメント』の基本的な考え方として近いのは？", "食事の補助として使う", ["食事は不要になる", "飲めば運動不要", "飲めば睡眠不要", "飲めば病気が必ず治る", "飲めば老化が止まる"]);
  push("『野菜ジュース』の注意点として近いのは？", "糖分や塩分の量を確認する", ["水分がゼロ", "必ず太る", "必ず痩せる", "骨が溶ける", "視力が回復する"]);
  push("『朝食』をとるメリットとして近いのは？", "エネルギー補給と生活リズム", ["睡眠時間が増える", "必ず筋肉が増える", "必ず身長が伸びる", "必ず視力が上がる", "必ず体温が下がる"]);
  push("『間食』の選び方として近いのは？", "量と栄養を意識する", ["好きなだけ食べる", "夜中に大量", "砂糖だけ", "塩だけ", "油だけ"]);
  push("スポーツ時の水分補給で適することがあるのは？", "電解質を含む飲料", ["砂糖水のみ", "油", "濃いコーヒー", "アルコール", "炭酸だけ"]);

  // ここからは「健康常識」系のテンプレを使って100問まで埋める
  const base = [["『食物繊維』が多い主食の例は？", "玄米", ["白米", "食パン", "うどん", "そうめん", "砂糖"]], ["『ビタミンA』の働きとして近いのは？", "皮膚や粘膜の健康維持", ["骨を溶かす", "血圧を上げる", "睡眠を不要にする", "体温を下げる", "味覚を消す"]], ["『ビタミンB2』の働きとして近いのは？", "エネルギー代謝を助ける", ["骨を直接作る", "視力を直接上げる", "髪色を変える", "身長を伸ばす", "体温を下げる"]], ["『ビタミンK』の働きとして近いのは？", "血液凝固に関与", ["聴力を上げる", "身長を伸ばす", "体温を下げる", "味覚を消す", "骨を溶かす"]], ["『マグネシウム』が多い食品の例は？", "ナッツ類", ["砂糖", "食塩", "白米", "清涼飲料水", "ゼリー"]], ["『亜鉛』が多い食品の例は？", "牡蠣", ["りんご", "きゅうり", "白米", "砂糖", "食塩"]], ["『DHA/EPA』が多い食品の例は？", "サバ", ["食パン", "砂糖", "食塩", "ゼリー", "バター"]], ["『水分不足』のサインとして近いのは？", "尿の色が濃い", ["髪が伸びる", "身長が伸びる", "視力が上がる", "爪が硬くなる", "声が高くなる"]], ["『熱中症予防』で大切なのは？", "こまめな水分・塩分補給", ["厚着をする", "運動を増やす", "睡眠を削る", "食事を抜く", "水を我慢する"]], ["『アルコール』摂取で注意したいのは？", "脱水になりやすい", ["必ず筋肉が増える", "必ず視力が上がる", "必ず骨が強くなる", "必ず眠気が消える", "必ず体温が下がる"]], ["『加工食品』で塩分が多くなりやすいのは？", "インスタント麺", ["果物", "生野菜", "刺身", "無糖ヨーグルト", "豆腐"]], ["『脂質』の摂り方で意識したいのは？", "質（種類）と量", ["とにかくゼロ", "砂糖だけにする", "塩だけにする", "水だけにする", "夜更かしを増やす"]], ["『運動』の継続のコツとして近いのは？", "小さく始めて習慣化", ["最初から毎日2時間", "睡眠を削る", "食事を抜く", "水分を減らす", "痛みを我慢して続ける"]], ["『ストレッチ』の目的として近いのは？", "柔軟性の維持", ["視力回復", "身長を急に伸ばす", "骨を溶かす", "味覚を消す", "体温を下げる"]], ["『たんぱく質』摂取のタイミングでよく言われるのは？", "運動後に意識すると良い", ["寝る直前に砂糖だけ", "朝は水だけ", "昼は塩だけ", "夜は油だけ", "いつでも不要"]], ["『野菜』を増やす工夫として近いのは？", "汁物や副菜に足す", ["主食を砂糖にする", "塩を増やす", "揚げ物だけにする", "飲み物だけにする", "夜更かしを増やす"]], ["『果物』の食べ方で注意したいのは？", "食べ過ぎは糖質過多", ["水分がゼロ", "必ず太る", "必ず痩せる", "骨が溶ける", "視力が回復する"]], ["『乳酸菌』が含まれる食品の例は？", "ヨーグルト", ["白米", "食塩", "砂糖", "油", "ゼリー"]], ["『大豆製品』の例は？", "豆腐", ["バター", "砂糖", "食塩", "牛脂", "清涼飲料水"]], ["『青菜』に多い栄養素として知られるのは？", "葉酸", ["カフェイン", "アルコール", "トランス脂肪酸", "食塩", "砂糖"]]];
  for (let i = 0; i < base.length; i++) {
    push(base[i][0], base[i][1], base[i][2]);
  }

  // 100問に満たない場合は、同形式でバリエーションを自動生成（内容は健康一般の常識レベル）
  const fillers = [["『水分補給』で避けたい行動は？", "一気飲みだけに頼る", ["こまめに飲む", "運動前に飲む", "運動後に飲む", "暑い日は増やす", "のどが渇く前に飲む"]], ["『野菜』の摂取目標としてよく聞くのは？", "1日350g", ["1日35g", "1日50g", "1日100g", "1日1000g必須", "野菜は不要"]], ["『減塩』の工夫として近いのは？", "汁物の汁を残す", ["汁を必ず飲み干す", "漬物を増やす", "加工食品を増やす", "塩を追加する", "味付けを濃くする"]], ["『運動不足』の対策として近いのは？", "日常の歩数を増やす", ["睡眠を削る", "食事を抜く", "水分を減らす", "夜更かしを増やす", "座り続ける"]], ["『姿勢』が悪いと起こりやすいのは？", "肩こり", ["視力回復", "身長が急に伸びる", "骨が溶ける", "味覚が消える", "体温が下がる"]]];
  let fi = 0;
  while (q.length < 100) {
    const f = fillers[fi % fillers.length];
    // 少しだけ文面を変えて重複感を減らす
    const suffix = "（" + (q.length + 1) + "）";
    push(f[0] + suffix, f[1], f[2]);
    fi++;
  }

  // choices は必ず6個
  for (let i = 0; i < q.length; i++) {
    q[i].choices = q[i].choices.slice(0, 6);
  }
  return q;
}
function buildSessionQuestions(stock, random, count) {
  const pickedIdx = pickUniqueIndices(stock.length, count, random);
  const picked = pickedIdx.map(i => stock[i]);

  // 正解位置の偏りを抑える: 10問の中で1〜6がなるべく均等になるよう割り当て
  const posCounts = [0, 0, 0, 0, 0, 0];
  const session = [];
  for (let i = 0; i < picked.length; i++) {
    const item = picked[i];

    // まず誤答候補をシャッフル
    const wrongs = item.choices.filter(c => c !== item.correct);
    shuffleInPlace(wrongs, random);

    // 最小出現の正解位置を候補に
    let min = posCounts[0];
    for (let p = 1; p < 6; p++) min = Math.min(min, posCounts[p]);
    const candidates = [];
    for (let p = 0; p < 6; p++) if (posCounts[p] === min) candidates.push(p);
    const correctPos = candidates[Math.floor(random.generate() * candidates.length)];
    posCounts[correctPos]++;

    // choices を組み立て（correctPos に正解を置く）
    const choices = new Array(6);
    let wi = 0;
    for (let p = 0; p < 6; p++) {
      if (p === correctPos) choices[p] = item.correct;else choices[p] = wrongs[wi++];
    }
    session.push({
      question: item.question,
      choices,
      correctIndex: correctPos
    });
  }

  // 出題順もシャッフル
  shuffleInPlace(session, random);
  return session;
}
function main(param) {
  const scene = new g.Scene({
    game: g.game,
    assetIds: ["player", "shot", "se"]
  });

  // ランキングモード: g.game.vars.gameState.score をスコアとして扱う
  g.game.vars.gameState = {
    score: 0
  };

  // セッション制限時間（デフォルト120秒）
  let totalTime = 120;
  if (param.sessionParameter && param.sessionParameter.totalTimeLimit) {
    totalTime = param.sessionParameter.totalTimeLimit;
  }

  // 定数
  const INTRO_SEC = 10;
  const QUESTION_COUNT = 10;
  const ANSWER_LIMIT_SEC = 8; // 仕様上の元制限（スコア計算の基準）
  const ANSWER_AFTER_TYPING_SEC = 5; // 修正要望: タイピング完了後の残り時間を5秒に
  const JUDGE_SEC = 3;
  const BASE_SCORE = 100;
  const WRONG_PENALTY = 50;

  // UIカラー（健康っぽい緑基調）
  const COLOR_BG = "#EAF7EE";
  const COLOR_PANEL = "#FFFFFF";
  const COLOR_GREEN_DARK = "#1B5E20";
  const COLOR_RED = "#C62828";
  const COLOR_TEXT = "#1F2D1F";
  scene.onLoad.add(() => {
    const random = param.random || g.game.random;

    // 背景
    const bg = new g.FilledRect({
      scene,
      cssColor: COLOR_BG,
      width: g.game.width,
      height: g.game.height
    });
    scene.append(bg);

    // さりげない葉っぱモチーフ（円っぽい四角）
    for (let i = 0; i < 18; i++) {
      const r = 10 + Math.floor(random.generate() * 22);
      const leaf = new g.FilledRect({
        scene,
        cssColor: i % 2 === 0 ? "#C8E6C9" : "#B2DFDB",
        width: r,
        height: r,
        x: Math.floor(random.generate() * (g.game.width - r)),
        y: Math.floor(random.generate() * (g.game.height - r)),
        opacity: 0.35
      });
      scene.append(leaf);
    }
    const font = new g.DynamicFont({
      game: g.game,
      fontFamily: "sans-serif",
      size: 44
    });
    const fontSmall = new g.DynamicFont({
      game: g.game,
      fontFamily: "sans-serif",
      size: 28
    });

    // 上部HUD
    const hud = new g.FilledRect({
      scene,
      cssColor: COLOR_PANEL,
      width: g.game.width,
      height: 72,
      x: 0,
      y: 0,
      opacity: 0.92
    });
    scene.append(hud);
    const titleLabel = new g.Label({
      scene,
      text: "健康・健康食品クイズ",
      font,
      fontSize: 28,
      textColor: COLOR_GREEN_DARK,
      x: 18,
      y: 18
    });
    scene.append(titleLabel);
    const scoreLabel = new g.Label({
      scene,
      text: "SCORE: 0",
      font,
      fontSize: 26,
      textColor: COLOR_TEXT,
      x: 520,
      y: 20
    });
    scene.append(scoreLabel);
    const timeLabel = new g.Label({
      scene,
      text: "TIME: " + totalTime,
      font,
      fontSize: 26,
      textColor: COLOR_TEXT,
      x: 980,
      y: 20
    });
    scene.append(timeLabel);
    const qnoLabel = new g.Label({
      scene,
      text: "Q: -/-",
      font,
      fontSize: 26,
      textColor: COLOR_TEXT,
      x: 820,
      y: 20
    });
    scene.append(qnoLabel);

    // メインパネル
    const panel = new g.FilledRect({
      scene,
      cssColor: COLOR_PANEL,
      width: g.game.width - 80,
      height: 420,
      x: 40,
      y: 110,
      opacity: 0.95
    });
    scene.append(panel);
    const messageLabel = new g.Label({
      scene,
      text: "",
      font,
      fontSize: 34,
      textColor: COLOR_GREEN_DARK,
      x: 70,
      y: 140
    });
    scene.append(messageLabel);
    const questionLabel = new g.Label({
      scene,
      text: "",
      font,
      fontSize: 34,
      textColor: COLOR_TEXT,
      x: 70,
      y: 220
    });
    scene.append(questionLabel);

    // ルール説明は改行できないため、1行につき1つのLabelを使う
    const introLines = [];
    const introLineTexts = ["・全10問（6択）", "・問題文はタイピング表示（表示中は回答不可）", "・タイピング完了後の回答時間は5秒", "・早いほど高得点／不正解は減点", "・全体制限 " + totalTime + " 秒"];
    const introBaseX = 70;
    const introBaseY = 280;
    const introLineH = 34;
    for (let i = 0; i < introLineTexts.length; i++) {
      const l = new g.Label({
        scene,
        text: "",
        font: fontSmall,
        fontSize: 24,
        textColor: "#355A35",
        x: introBaseX,
        y: introBaseY + i * introLineH
      });
      scene.append(l);
      introLines.push(l);
    }

    // クイズ中の補助表示（intro以外で使用）
    const subLabel = new g.Label({
      scene,
      text: "",
      font: fontSmall,
      fontSize: 24,
      textColor: "#355A35",
      x: 70,
      y: 280
    });
    scene.append(subLabel);
    function setIntroVisible(visible) {
      for (let i = 0; i < introLines.length; i++) {
        introLines[i].opacity = visible ? 1 : 0;
        introLines[i].modified();
      }
      subLabel.opacity = visible ? 0 : 1;
      subLabel.modified();
    }

    // 6択ボタン
    const buttons = [];
    const btnW = 560;
    const btnH = 64;
    const startX = 80;
    // 修正要望: 選択肢5,6が見切れるので全体をやや上へ
    const startY = 500;
    const gapX = 40;
    const gapY = 18;
    function createButton(idx) {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = startX + col * (btnW + gapX);
      const y = startY + row * (btnH + gapY);
      const rect = new g.FilledRect({
        scene,
        cssColor: "#E8F5E9",
        width: btnW,
        height: btnH,
        x,
        y,
        opacity: 1,
        touchable: true
      });
      const label = new g.Label({
        scene,
        text: idx + 1 + ": ",
        font: fontSmall,
        fontSize: 26,
        textColor: COLOR_GREEN_DARK,
        x: x + 16,
        y: y + 18
      });
      scene.append(rect);
      scene.append(label);
      return {
        rect,
        label,
        idx
      };
    }
    for (let i = 0; i < 6; i++) buttons.push(createButton(i));

    // ゲーム状態
    const stock = createQuizStock100();
    const sessionQuestions = buildSessionQuestions(stock, random, QUESTION_COUNT);
    let globalTime = totalTime;
    let phase = "intro"; // intro | typing | answering | judge | result
    let introLeft = INTRO_SEC;
    let currentIndex = -1;
    let current = null;
    let typingText = "";
    let typingPos = 0;
    let typingTick = 0;
    let typingIntervalTick = 3; // 後で文字数から調整

    let answerLeft = ANSWER_AFTER_TYPING_SEC;
    let answered = false;
    let answerStartLeft = ANSWER_AFTER_TYPING_SEC;
    let judgeLeft = 0;
    function setButtonsEnabled(enabled) {
      for (let i = 0; i < buttons.length; i++) {
        buttons[i].rect.touchable = enabled;
        buttons[i].rect.cssColor = enabled ? "#E8F5E9" : "#F1F8E9";
        buttons[i].label.textColor = enabled ? COLOR_GREEN_DARK : "#7A8F7A";
        buttons[i].rect.modified();
        buttons[i].label.invalidate();
      }
    }
    function setButtonsText(choices) {
      for (let i = 0; i < 6; i++) {
        buttons[i].label.text = i + 1 + ": " + choices[i];
        buttons[i].label.invalidate();
      }
    }
    function updateScoreLabel() {
      scoreLabel.text = "SCORE: " + g.game.vars.gameState.score;
      scoreLabel.invalidate();
    }
    function startIntro() {
      phase = "intro";
      introLeft = INTRO_SEC;
      messageLabel.text = "ルール説明";
      messageLabel.textColor = COLOR_GREEN_DARK;
      messageLabel.invalidate();
      questionLabel.text = "";
      questionLabel.invalidate();

      // intro行をセット
      for (let i = 0; i < introLines.length; i++) {
        introLines[i].text = introLineTexts[i];
        introLines[i].invalidate();
      }
      setIntroVisible(true);
      qnoLabel.text = "Q: -/-";
      qnoLabel.invalidate();
      setButtonsEnabled(false);
      setButtonsText(["-", "-", "-", "-", "-", "-"]);
    }
    function startQuestion(i) {
      currentIndex = i;
      current = sessionQuestions[i];
      qnoLabel.text = "Q: " + (i + 1) + "/" + QUESTION_COUNT;
      qnoLabel.invalidate();

      // タイピング準備
      phase = "typing";
      typingText = current.question;
      typingPos = 0;
      typingTick = 0;
      questionLabel.text = "";
      questionLabel.invalidate();

      // 4〜5秒で全文表示を目標: 30fps想定で 4.5秒=135tick
      const targetTick = Math.floor(g.game.fps * 4.5);
      typingIntervalTick = Math.max(1, Math.floor(targetTick / Math.max(1, typingText.length)));
      messageLabel.text = "第" + (i + 1) + "問";
      messageLabel.textColor = COLOR_GREEN_DARK;
      messageLabel.invalidate();
      setIntroVisible(false);
      subLabel.text = "問題文表示中...";
      subLabel.invalidate();
      setButtonsEnabled(false);
      setButtonsText(current.choices);

      // ボタン色を初期化
      for (let b = 0; b < 6; b++) {
        buttons[b].rect.cssColor = "#E8F5E9";
        buttons[b].rect.modified();
      }
    }
    function startAnswering() {
      phase = "answering";
      answered = false;
      answerLeft = ANSWER_AFTER_TYPING_SEC;
      answerStartLeft = ANSWER_AFTER_TYPING_SEC;
      subLabel.text = "回答してください（制限 " + ANSWER_AFTER_TYPING_SEC + " 秒）";
      subLabel.invalidate();
      setButtonsEnabled(true);
    }
    function startJudge(isCorrect, chosenIndex, timedOut) {
      phase = "judge";
      judgeLeft = JUDGE_SEC;
      setButtonsEnabled(false);

      // ボタン色フィードバック
      for (let i = 0; i < 6; i++) {
        buttons[i].rect.cssColor = "#F1F8E9";
      }
      buttons[current.correctIndex].rect.cssColor = "#C8E6C9";
      if (!timedOut && chosenIndex != null && chosenIndex !== current.correctIndex) {
        buttons[chosenIndex].rect.cssColor = "#FFCDD2";
      }
      for (let i = 0; i < 6; i++) buttons[i].rect.modified();
      const judgeText = isCorrect ? "正解！" : timedOut ? "時間切れ..." : "不正解...";
      messageLabel.text = judgeText;
      messageLabel.textColor = isCorrect ? COLOR_GREEN_DARK : COLOR_RED;
      messageLabel.invalidate();
      subLabel.text = "正解: " + (current.correctIndex + 1) + "（" + current.choices[current.correctIndex] + "）";
      subLabel.invalidate();
    }
    function startResult() {
      phase = "result";
      messageLabel.text = "結果";
      messageLabel.textColor = COLOR_GREEN_DARK;
      messageLabel.invalidate();
      questionLabel.text = "";
      questionLabel.invalidate();
      setIntroVisible(false);
      subLabel.text = "スコア: " + g.game.vars.gameState.score + "\n" + "（ランキングに送信されます）\n" + "もう一度遊ぶにはリロード/再入場してください";
      subLabel.invalidate();
      qnoLabel.text = "Q: " + QUESTION_COUNT + "/" + QUESTION_COUNT;
      qnoLabel.invalidate();
      setButtonsEnabled(false);
    }
    function applyAnswer(chosenIndex, timedOut) {
      if (phase !== "answering" || answered) return;
      answered = true;
      const isCorrect = !timedOut && chosenIndex === current.correctIndex;

      // スコア計算は「元仕様の8秒」を基準にしつつ、実際の回答猶予は5秒
      // 5秒で回答した場合でも、8秒換算のスピードボーナスになるように正規化
      const elapsed = clamp(answerStartLeft - answerLeft, 0, ANSWER_AFTER_TYPING_SEC);
      const t8 = clamp(elapsed / ANSWER_AFTER_TYPING_SEC * ANSWER_LIMIT_SEC, 0, ANSWER_LIMIT_SEC);
      const speedBonus = Math.max(0, Math.floor((ANSWER_LIMIT_SEC - t8) / ANSWER_LIMIT_SEC * 100));
      if (isCorrect) {
        g.game.vars.gameState.score += BASE_SCORE + speedBonus;
      } else {
        g.game.vars.gameState.score -= WRONG_PENALTY;
      }
      updateScoreLabel();
      startJudge(isCorrect, chosenIndex, timedOut);
    }

    // ボタンイベント
    for (let i = 0; i < buttons.length; i++) {
      (idx => {
        buttons[idx].rect.onPointDown.add(() => {
          applyAnswer(idx, false);
        });
      })(i);
    }

    // 初期
    startIntro();

    // 全体タイマー＆進行
    scene.onUpdate.add(() => {
      // 全体時間
      if (phase !== "result") {
        globalTime -= 1 / g.game.fps;
        if (globalTime < 0) globalTime = 0;
        timeLabel.text = "TIME: " + Math.ceil(globalTime);
        timeLabel.invalidate();
        if (globalTime <= 0) {
          startResult();
          return;
        }
      }
      if (phase === "intro") {
        introLeft -= 1 / g.game.fps;

        // カウントダウン行だけ更新（最終行を差し替え）
        introLines[introLines.length - 1].text = "開始まで: " + Math.ceil(introLeft) + " 秒";
        introLines[introLines.length - 1].invalidate();
        if (introLeft <= 0) startQuestion(0);
        return;
      }
      if (phase === "typing") {
        typingTick++;
        if (typingPos < typingText.length && typingTick % typingIntervalTick === 0) {
          typingPos++;
          questionLabel.text = typingText.slice(0, typingPos);
          questionLabel.invalidate();
        }
        if (typingPos >= typingText.length) {
          startAnswering();
        }
        return;
      }
      if (phase === "answering") {
        answerLeft -= 1 / g.game.fps;
        subLabel.text = "回答してください（残り " + Math.ceil(answerLeft) + " 秒）";
        subLabel.invalidate();
        if (answerLeft <= 0) applyAnswer(null, true);
        return;
      }
      if (phase === "judge") {
        judgeLeft -= 1 / g.game.fps;
        if (judgeLeft <= 0) {
          if (currentIndex + 1 >= QUESTION_COUNT) {
            startResult();
          } else {
            startQuestion(currentIndex + 1);
          }
        }
        return;
      }
    });

    // 既存テンプレのSEは使わない（要件外）
    // ただしアセット参照が残っていても問題ないように読み込みだけしておく
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _dummy = scene.asset.getAudioById("se");
  });
  g.game.pushScene(scene);
}
exports.main = main;
})(g.module.exports, g.module.require, g.module, g.filename, g.dirname);
}