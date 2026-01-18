window.gLocalAssetContainer["main"] = function(g) { (function(exports, require, module, __filename, __dirname) {
/*
 * ニコ生風 神経衰弱ランキング
 * - ルール説明(10秒) → ゲーム(40秒) → 結果
 * - 4x8=32枚 (通常1-12を各2枚=24枚 + 特殊4種を各2枚=8枚)
 * - 特殊効果: ×n, +n, ±50, ×/÷5
 *
 * 注意:
 * - g.Label には textBaseline が無い環境があるため使用しない
 * - main は require("./main").main で呼べるよう module.exports.main で定義
 */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function shuffle(arr, random) {
  for (let i = arr.length - 1; i > 0; --i) {
    const j = Math.floor(random.generate() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}
function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}
function createTheme() {
  // 高コントラスト・ダークテーマ
  return {
    bg: "#0b1020",
    panel: "#121a33",
    text: "#f2f6ff",
    subText: "#cfe0ff",
    accent: "#3a79ff",
    cardBack: "#1a2447",
    cardFront: "#f7f9fc",
    cardBorder: "#3a79ff",
    cardText: "#11131e",
    specialCardFront: "#fff3d6",
    specialText: "#3b2a00"
  };
}
function createPanel(scene, x, y, w, h, color, opacity) {
  const rect = new g.FilledRect({
    scene,
    x,
    y,
    width: w,
    height: h,
    cssColor: color,
    opacity: opacity == null ? 1 : opacity
  });
  scene.append(rect);
  return rect;
}
function createCenteredLabel(scene, text, x, y, w, h, font, color, fontSize) {
  // g.Label で中央寄せ: textAlign + width を指定
  // 垂直中央は textBaseline を使わず、y を (中心 - fontSize/2) で調整する
  const label = new g.Label({
    scene,
    text,
    font,
    fontSize,
    textColor: color,
    x,
    y: y + Math.floor((h - fontSize) / 2),
    width: w,
    height: h,
    textAlign: g.TextAlign.Center
  });
  scene.append(label);
  return label;
}
function computeIncrement(baseAdd, effects) {
  let v = baseAdd;
  // 乗算系
  let mul = 1;
  for (let i = 0; i < effects.length; ++i) {
    const e = effects[i];
    if (!e.active) continue;
    if (e.kind === "multiply") mul *= e.value;
    if (e.kind === "mulOrDiv5") mul *= e.value; // value は 5 または 0.2
  }
  v = v * mul;

  // 加算系
  let add = 0;
  for (let i = 0; i < effects.length; ++i) {
    const e = effects[i];
    if (!e.active) continue;
    if (e.kind === "add") add += e.value;
    if (e.kind === "plusMinus50") add += e.value; // +50 or -50
  }
  v = v + add;

  // 整数化: 四捨五入
  return Math.round(v);
}
function createRuleScene(game) {
  const theme = createTheme();
  const scene = new g.Scene({
    game
  });
  scene.onLoad.add(function () {
    // 背景
    scene.append(new g.FilledRect({
      scene,
      width: game.width,
      height: game.height,
      cssColor: theme.bg
    }));
    const font = new g.DynamicFont({
      game,
      fontFamily: "sans-serif",
      size: 24
    });
    const fontSmall = new g.DynamicFont({
      game,
      fontFamily: "sans-serif",
      size: 18
    });

    // パネル
    const pad = 24;
    const panelW = game.width - pad * 2;
    const panelH = game.height - pad * 2;
    createPanel(scene, pad, pad, panelW, panelH, theme.panel, 0.92);
    createCenteredLabel(scene, "神経衰弱ランキング on ニコ生風", pad, pad + 10, panelW, 40, font, theme.text, 24);
    const lines = ["・40秒でできるだけ多くペアを揃えよう", "・数字ペア: (数字+数字) が基本加点", "・特殊ペアを揃えると効果が発動し、以後の加点に常時適用", "　×n (2/3/4), ＋n (10/20/30), ±50, ×/÷5", "・効果は画面上部の『効果』に表示されます", "・タップ/クリックでカードをめくる（2枚で判定）"];
    let y = pad + 70;
    for (let i = 0; i < lines.length; ++i) {
      const lb = new g.Label({
        scene,
        text: lines[i],
        font: fontSmall,
        fontSize: 18,
        textColor: theme.subText,
        x: pad + 18,
        y,
        width: panelW - 36
      });
      scene.append(lb);
      y += 28;
    }
    let remain = 10;
    const cd = createCenteredLabel(scene, "開始まで: 10", pad, pad + panelH - 70, panelW, 40, font, theme.accent, 24);
    scene.setInterval(function () {
      remain--;
      cd.text = "開始まで: " + remain;
      cd.invalidate();
      if (remain <= 0) {
        game.replaceScene(createGameScene(game, theme));
      }
    }, 1000);
  });
  return scene;
}
function createGameScene(game, theme) {
  const scene = new g.Scene({
    game
  });
  scene.onLoad.add(function () {
    scene.append(new g.FilledRect({
      scene,
      width: game.width,
      height: game.height,
      cssColor: theme.bg
    }));
    const font = new g.DynamicFont({
      game,
      fontFamily: "sans-serif",
      size: 20
    });
    const fontCard = new g.DynamicFont({
      game,
      fontFamily: "sans-serif",
      size: 22
    });
    let score = 0;
    let timeLeft = 40;
    const headerH = 64;
    createPanel(scene, 0, 0, game.width, headerH, theme.panel, 0.92);
    const timeLabel = new g.Label({
      scene,
      text: "残り: 40",
      font,
      fontSize: 20,
      textColor: theme.text,
      x: 12,
      y: 10
    });
    scene.append(timeLabel);
    const scoreLabel = new g.Label({
      scene,
      text: "スコア: 0",
      font,
      fontSize: 20,
      textColor: theme.text,
      x: 12,
      y: 34
    });
    scene.append(scoreLabel);
    const effectLabel = new g.Label({
      scene,
      text: "効果: なし",
      font,
      fontSize: 18,
      textColor: theme.subText,
      x: 220,
      y: 20,
      width: game.width - 230
    });
    scene.append(effectLabel);
    const msgLabel = new g.Label({
      scene,
      text: "",
      font,
      fontSize: 18,
      textColor: theme.accent,
      x: 12,
      y: headerH + 6,
      width: game.width - 24
    });
    scene.append(msgLabel);

    // デッキ生成
    /** @type {{type:"normal"|"special", key:string, value?:number, specialKind?:string}[]} */
    const deck = [];
    for (let n = 1; n <= 12; ++n) {
      deck.push({
        type: "normal",
        key: "n_" + n,
        value: n
      });
      deck.push({
        type: "normal",
        key: "n_" + n,
        value: n
      });
    }
    const specials = ["A", "B", "C", "D"]; // A:×n, B:+n, C:±50, D:×/÷5
    for (let i = 0; i < specials.length; ++i) {
      deck.push({
        type: "special",
        key: "s_" + specials[i],
        specialKind: specials[i]
      });
      deck.push({
        type: "special",
        key: "s_" + specials[i],
        specialKind: specials[i]
      });
    }
    shuffle(deck, game.random);

    // 効果
    /** @type {{id:string, kind:string, value:number, active:boolean, label:string}[]} */
    const effects = [];
    function updateEffectLabel() {
      const act = effects.filter(e => e.active).map(e => e.label);
      effectLabel.text = "効果: " + (act.length ? act.join(" / ") : "なし");
      effectLabel.invalidate();
    }
    function activateSpecial(kind) {
      // 同種は1回だけ
      const id = "spec_" + kind;
      for (let i = 0; i < effects.length; ++i) if (effects[i].id === id) return;
      if (kind === "A") {
        const choices = [2, 3, 4];
        const n = choices[Math.floor(game.random.generate() * choices.length)];
        effects.push({
          id,
          kind: "multiply",
          value: n,
          active: true,
          label: "×" + n
        });
        msgLabel.text = "特殊効果発動: ×" + n;
      }
      if (kind === "B") {
        const choices = [10, 20, 30];
        const n = choices[Math.floor(game.random.generate() * choices.length)];
        effects.push({
          id,
          kind: "add",
          value: n,
          active: true,
          label: "+" + n
        });
        msgLabel.text = "特殊効果発動: +" + n;
      }
      if (kind === "C") {
        const sign = game.random.generate() < 0.5 ? 1 : -1;
        const v = 50 * sign;
        effects.push({
          id,
          kind: "plusMinus50",
          value: v,
          active: true,
          label: (v >= 0 ? "+" : "") + v
        });
        msgLabel.text = "特殊効果発動: " + (v >= 0 ? "+50" : "-50");
      }
      if (kind === "D") {
        const mul = game.random.generate() < 0.5 ? 5 : 0.2; // ÷5 は 0.2倍
        effects.push({
          id,
          kind: "mulOrDiv5",
          value: mul,
          active: true,
          label: mul === 5 ? "×5" : "÷5"
        });
        msgLabel.text = "特殊効果発動: " + (mul === 5 ? "×5" : "÷5");
      }
      msgLabel.invalidate();
      updateEffectLabel();
    }

    // 盤面
    const cols = 4;
    const rows = 8;
    const gap = 8;
    const boardTop = headerH + 34;
    const boardH = game.height - boardTop - 10;
    const cardW = Math.floor((game.width - gap * (cols + 1)) / cols);
    const cardH = Math.floor((boardH - gap * (rows + 1)) / rows);

    /** @type {{idx:number, data:any, rect:g.FilledRect, face:g.FilledRect, label:g.Label, revealed:boolean, matched:boolean}[]} */
    const cards = [];
    let first = null;
    let second = null;
    let lock = false;
    function cardFaceText(d) {
      if (d.type === "normal") return String(d.value);
      if (d.specialKind === "A") return "×?";
      if (d.specialKind === "B") return "+?";
      if (d.specialKind === "C") return "±50";
      return "×/÷5";
    }
    function reveal(c, on) {
      c.revealed = on;
      if (on) {
        c.face.opacity = 1;
        c.label.opacity = 1;
      } else {
        c.face.opacity = 0;
        c.label.opacity = 0;
      }
      c.face.modified();
      c.label.modified();
    }
    function setMatched(c) {
      c.matched = true;
      c.rect.cssColor = "#2a355f";
      c.rect.opacity = 0.6;
      c.rect.modified();
    }
    function judge() {
      if (!first || !second) return;
      lock = true;
      const a = first;
      const b = second;
      const ok = a.data.key === b.data.key;
      scene.setTimeout(function () {
        if (ok) {
          setMatched(a);
          setMatched(b);
          if (a.data.type === "normal") {
            const baseAdd = a.data.value + b.data.value;
            const inc = computeIncrement(baseAdd, effects);
            score += inc;
            scoreLabel.text = "スコア: " + score;
            scoreLabel.invalidate();
            msgLabel.text = "ペア成立! +" + inc + " (基本" + baseAdd + ")";
            msgLabel.invalidate();
          } else {
            activateSpecial(a.data.specialKind);
          }
        } else {
          reveal(a, false);
          reveal(b, false);
          msgLabel.text = "不一致…";
          msgLabel.invalidate();
        }
        first = null;
        second = null;
        lock = false;
      }, 550);
    }
    for (let r = 0; r < rows; ++r) {
      for (let c = 0; c < cols; ++c) {
        const idx = r * cols + c;
        const d = deck[idx];
        const x = gap + c * (cardW + gap);
        const y = boardTop + gap + r * (cardH + gap);
        const rect = new g.FilledRect({
          scene,
          x,
          y,
          width: cardW,
          height: cardH,
          cssColor: theme.cardBack,
          opacity: 1,
          touchable: true
        });
        scene.append(rect);
        const face = new g.FilledRect({
          scene,
          x: x + 2,
          y: y + 2,
          width: cardW - 4,
          height: cardH - 4,
          cssColor: d.type === "special" ? theme.specialCardFront : theme.cardFront,
          opacity: 0
        });
        scene.append(face);
        const label = new g.Label({
          scene,
          text: cardFaceText(d),
          font: fontCard,
          fontSize: 22,
          textColor: d.type === "special" ? theme.specialText : theme.cardText,
          x: x,
          // textBaseline を使わず、y を中央寄せ相当に調整
          y: y + Math.floor((cardH - 22) / 2),
          width: cardW,
          height: cardH,
          textAlign: g.TextAlign.Center,
          opacity: 0
        });
        scene.append(label);
        const card = {
          idx,
          data: d,
          rect,
          face,
          label,
          revealed: false,
          matched: false
        };
        cards.push(card);
        rect.onPointDown.add(function () {
          if (lock) return;
          if (card.matched) return;
          if (card.revealed) return;
          reveal(card, true);
          if (!first) {
            first = card;
            return;
          }
          second = card;
          judge();
        });
      }
    }
    updateEffectLabel();

    // タイマー
    const timerId = scene.setInterval(function () {
      timeLeft--;
      timeLabel.text = "残り: " + pad2(timeLeft);
      timeLabel.invalidate();
      if (timeLeft <= 0) {
        scene.clearInterval(timerId);
        game.replaceScene(createResultScene(game, theme, score));
      }
    }, 1000);
  });
  return scene;
}
function createResultScene(game, theme, score) {
  const scene = new g.Scene({
    game
  });
  scene.onLoad.add(function () {
    scene.append(new g.FilledRect({
      scene,
      width: game.width,
      height: game.height,
      cssColor: theme.bg
    }));
    const font = new g.DynamicFont({
      game,
      fontFamily: "sans-serif",
      size: 26
    });
    const fontSmall = new g.DynamicFont({
      game,
      fontFamily: "sans-serif",
      size: 18
    });
    const pad = 24;
    const panelW = game.width - pad * 2;
    const panelH = game.height - pad * 2;
    createPanel(scene, pad, pad, panelW, panelH, theme.panel, 0.92);
    createCenteredLabel(scene, "結果", pad, pad + 10, panelW, 40, font, theme.text, 26);
    createCenteredLabel(scene, "スコア: " + score, pad, pad + 70, panelW, 40, font, theme.accent, 26);
    const info = new g.Label({
      scene,
      text: "ランキング対応: 環境が submitScore を提供している場合は自動送信します。",
      font: fontSmall,
      fontSize: 18,
      textColor: theme.subText,
      x: pad + 18,
      y: pad + 130,
      width: panelW - 36
    });
    scene.append(info);

    // ランキング送信(存在する場合)
    try {
      if (typeof game.vars === "object" && game.vars && typeof game.vars.submitScore === "function") {
        game.vars.submitScore(score);
      }
    } catch (e) {
      // noop
    }

    // ボタン
    const btnW = 220;
    const btnH = 52;
    const bx = Math.floor((game.width - btnW) / 2);
    const by = pad + panelH - 90;
    const btn = new g.FilledRect({
      scene,
      x: bx,
      y: by,
      width: btnW,
      height: btnH,
      cssColor: theme.accent,
      opacity: 1,
      touchable: true
    });
    scene.append(btn);
    createCenteredLabel(scene, "もう一回", bx, by, btnW, btnH, font, "#ffffff", 24);
    btn.onPointDown.add(function () {
      game.replaceScene(createRuleScene(game));
    });
  });
  return scene;
}
module.exports.main = function () {
  g.game.pushScene(createRuleScene(g.game));
};
})(g.module.exports, g.module.require, g.module, g.filename, g.dirname);
}