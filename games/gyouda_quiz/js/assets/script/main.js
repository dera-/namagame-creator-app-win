window.gLocalAssetContainer["main"] = function(g) { (function(exports, require, module, __filename, __dirname) {
"use strict";

// 行田市/行田市議会クイズ（ランキング・120秒）
// - ルール説明10秒 → クイズ10問（各8秒回答 + 3秒結果）
// - 問題文はタイプライタ表記（約4.5秒で全文）
// - 6択、早押しほど加点、誤答/時間切れは減点
exports.main = void 0;
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
function createNinePatchRect(scene, x, y, w, h, color, borderColor, borderWidth, opacity) {
  const g1 = new g.FilledRect({
    scene,
    x,
    y,
    width: w,
    height: h,
    cssColor: color,
    opacity: opacity == null ? 1 : opacity
  });
  const b = borderWidth || 0;
  if (b > 0) {
    scene.append(g1);
    scene.append(new g.FilledRect({
      scene,
      x,
      y,
      width: w,
      height: b,
      cssColor: borderColor,
      opacity: 1
    }));
    scene.append(new g.FilledRect({
      scene,
      x,
      y: y + h - b,
      width: w,
      height: b,
      cssColor: borderColor,
      opacity: 1
    }));
    scene.append(new g.FilledRect({
      scene,
      x,
      y,
      width: b,
      height: h,
      cssColor: borderColor,
      opacity: 1
    }));
    scene.append(new g.FilledRect({
      scene,
      x: x + w - b,
      y,
      width: b,
      height: h,
      cssColor: borderColor,
      opacity: 1
    }));
    return g1;
  }
  return g1;
}
function loadQuestions(scene) {
  const txt = scene.asset.getTextById("questions").data;
  const data = JSON.parse(txt);
  return data.questions;
}
function pick10QuestionsWithDistributedCorrectPos(stock, random) {
  const indices = stock.map((_, i) => i);
  shuffle(indices, random);
  const picked = indices.slice(0, 10).map(i => {
    const q = stock[i];
    return {
      id: q.id,
      text: q.text,
      choices: q.choices.slice(0, 6),
      correctIndex: q.correctIndex,
      meta: q.meta || {}
    };
  });
  const target = [];
  for (let i = 1; i <= 6; ++i) target.push(i);
  for (let k = 0; k < 4; ++k) target.push(1 + Math.floor(random.generate() * 6));
  shuffle(target, random);
  for (let i = 0; i < picked.length; ++i) {
    const q = picked[i];
    const desired = target[i];
    const current = q.correctIndex;
    if (desired !== current) {
      const a = desired - 1;
      const b = current - 1;
      const tmp = q.choices[a];
      q.choices[a] = q.choices[b];
      q.choices[b] = tmp;
      q.correctIndex = desired;
    }
  }
  shuffle(picked, random);
  return picked;
}
function main(param) {
  const scene = new g.Scene({
    game: g.game,
    assetIds: ["questions", "bgm", "seCorrect", "seWrong"]
  });
  g.game.vars.gameState = {
    score: 0
  };
  const TOTAL_TIME = 120;
  const RULE_TIME = 10;
  const ANSWER_TIME = 8;
  const RESULT_TIME = 3;
  const QUESTION_COUNT = 10;
  const BASE = 1000;
  const MISS_PENALTY = 300;
  const TYPE_TOTAL_SEC = 4.5;
  const COLOR_BG = "#e8f2e3";
  const COLOR_PANEL = "#f7f1e3";
  const COLOR_BORDER = "#6b4f2a";
  const COLOR_ACCENT = "#c0392b";
  const COLOR_GREEN = "#2e7d32";
  const COLOR_TEXT = "#1f1f1f";
  const COLOR_RULE_TEXT = "#1f2a37";
  scene.onLoad.add(() => {
    const random = param.random || g.game.random;
    const bgmAsset = scene.asset.getAudioById("bgm");
    const seCorrect = scene.asset.getAudioById("seCorrect");
    const seWrong = scene.asset.getAudioById("seWrong");
    let bgmPlayer = null;
    if (bgmAsset) {
      bgmPlayer = bgmAsset.play({
        loop: true
      });
      if (bgmPlayer && bgmPlayer.changeVolume) {
        bgmPlayer.changeVolume(0.45);
      }
    }
    const fontL = new g.DynamicFont({
      game: g.game,
      fontFamily: "sans-serif",
      size: 48
    });
    const fontM = new g.DynamicFont({
      game: g.game,
      fontFamily: "sans-serif",
      size: 32
    });
    const fontS = new g.DynamicFont({
      game: g.game,
      fontFamily: "sans-serif",
      size: 24
    });
    const fontRule = new g.DynamicFont({
      game: g.game,
      fontFamily: "sans-serif",
      size: 30,
      fontColor: COLOR_RULE_TEXT
    });
    scene.append(new g.FilledRect({
      scene,
      width: g.game.width,
      height: g.game.height,
      cssColor: COLOR_BG
    }));
    const topBarH = 72;
    scene.append(new g.FilledRect({
      scene,
      x: 0,
      y: 0,
      width: g.game.width,
      height: topBarH,
      cssColor: "#ffffff",
      opacity: 0.85
    }));
    scene.append(new g.FilledRect({
      scene,
      x: 0,
      y: topBarH - 2,
      width: g.game.width,
      height: 2,
      cssColor: COLOR_BORDER
    }));
    const scoreLabel = new g.Label({
      scene,
      x: 16,
      y: 16,
      font: fontM,
      fontSize: fontM.size,
      text: "SCORE: 0",
      textColor: COLOR_TEXT
    });
    scene.append(scoreLabel);
    const qnoLabel = new g.Label({
      scene,
      x: g.game.width - 16,
      y: 16,
      anchorX: 1,
      font: fontM,
      fontSize: fontM.size,
      text: "Q 0/10",
      textColor: COLOR_TEXT
    });
    scene.append(qnoLabel);
    const totalTimeLabel = new g.Label({
      scene,
      x: g.game.width / 2,
      y: 18,
      anchorX: 0.5,
      font: fontS,
      fontSize: fontS.size,
      text: "TIME 120",
      textColor: COLOR_TEXT
    });
    scene.append(totalTimeLabel);
    const barW = 520;
    const barH = 16;
    const barX = (g.game.width - barW) / 2;
    const barY = 44;
    scene.append(new g.FilledRect({
      scene,
      x: barX,
      y: barY,
      width: barW,
      height: barH,
      cssColor: "#d7d7d7"
    }));
    const barFill = new g.FilledRect({
      scene,
      x: barX,
      y: barY,
      width: barW,
      height: barH,
      cssColor: COLOR_GREEN
    });
    scene.append(barFill);
    scene.append(new g.FilledRect({
      scene,
      x: barX,
      y: barY,
      width: barW,
      height: 2,
      cssColor: COLOR_BORDER
    }));
    scene.append(new g.FilledRect({
      scene,
      x: barX,
      y: barY + barH - 2,
      width: barW,
      height: 2,
      cssColor: COLOR_BORDER
    }));
    const panelX = 80;
    const panelY = 110;
    const panelW = g.game.width - 160;
    const panelH = 260;
    createNinePatchRect(scene, panelX, panelY, panelW, panelH, COLOR_PANEL, COLOR_BORDER, 3, 0.95);
    const titleLabel = new g.Label({
      scene,
      x: panelX + 20,
      y: panelY + 16,
      font: fontS,
      fontSize: fontS.size,
      text: "行田市/行田市議会クイズ",
      textColor: COLOR_BORDER
    });
    scene.append(titleLabel);
    const questionLabel = new g.Label({
      scene,
      x: panelX + 20,
      y: panelY + 60,
      width: panelW - 40,
      font: fontM,
      fontSize: fontM.size,
      text: "",
      textColor: COLOR_TEXT,
      lineBreak: true
    });
    scene.append(questionLabel);
    const overlay = new g.FilledRect({
      scene,
      width: g.game.width,
      height: g.game.height,
      cssColor: "#000000",
      opacity: 0.55
    });
    const rulePanelW = 920;
    const rulePanelH = 420;
    const rulePanelX = (g.game.width - rulePanelW) / 2;
    const rulePanelY = (g.game.height - rulePanelH) / 2;
    const rulePanel = new g.FilledRect({
      scene,
      x: rulePanelX,
      y: rulePanelY,
      width: rulePanelW,
      height: rulePanelH,
      cssColor: "#ffffff",
      opacity: 0.95
    });
    const ruleBorder = new g.FilledRect({
      scene,
      x: rulePanelX,
      y: rulePanelY,
      width: rulePanelW,
      height: 4,
      cssColor: COLOR_ACCENT
    });
    const ruleTitle = new g.Label({
      scene,
      x: g.game.width / 2,
      y: rulePanelY + 24,
      anchorX: 0.5,
      font: fontL,
      fontSize: fontL.size,
      text: "ルール説明",
      textColor: COLOR_ACCENT,
      shadowColor: "rgba(0, 0, 0, 0.35)",
      shadowOffsetX: 2,
      shadowOffsetY: 2
    });
    const ruleLines = ["・全10問/制限時間120秒（固定）", "・各問：8秒で回答（6択）→3秒で結果表示", "・早く正解するほど得点アップ！", "・不正解/時間切れは-300点", "・数字キー（1〜6）でも回答できます"];
    const ruleLineHeight = 36;
    const ruleLineLabels = [];
    ruleLines.forEach((line, idx) => {
      const ruleLineLabel = new g.Label({
        scene,
        x: rulePanelX + 40,
        y: rulePanelY + 100 + idx * ruleLineHeight,
        width: rulePanelW - 80,
        font: fontRule,
        fontSize: fontRule.size,
        text: line,
        textColor: COLOR_RULE_TEXT,
        shadowColor: "rgba(0, 0, 0, 0.3)",
        shadowOffsetX: 2,
        shadowOffsetY: 2
      });
      ruleLineLabels.push(ruleLineLabel);
    });
    const ruleCountdown = new g.Label({
      scene,
      x: g.game.width / 2,
      y: rulePanelY + rulePanelH - 70,
      anchorX: 0.5,
      font: fontL,
      fontSize: fontL.size,
      text: "開始まで 10",
      textColor: COLOR_GREEN,
      shadowColor: "rgba(0, 0, 0, 0.35)",
      shadowOffsetX: 2,
      shadowOffsetY: 2
    });
    const btnAreaY = 410;
    const btnW = 560;
    const btnH = 56;
    const btnGapY = 14;
    const btnGapX = 40;
    const leftX = (g.game.width - (btnW * 2 + btnGapX)) / 2;
    const buttons = [];
    for (let i = 0; i < 6; ++i) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = leftX + col * (btnW + btnGapX);
      const y = btnAreaY + row * (btnH + btnGapY);
      const base = new g.FilledRect({
        scene,
        x,
        y,
        width: btnW,
        height: btnH,
        cssColor: "#ffffff",
        opacity: 0.98,
        touchable: true
      });
      const border = new g.FilledRect({
        scene,
        x,
        y: y + btnH - 3,
        width: btnW,
        height: 3,
        cssColor: COLOR_BORDER
      });
      const numTag = new g.FilledRect({
        scene,
        x,
        y,
        width: 56,
        height: btnH,
        cssColor: COLOR_ACCENT,
        opacity: 0.95
      });
      const numLabel = new g.Label({
        scene,
        x: x + 28,
        y: y + 10,
        anchorX: 0.5,
        font: fontM,
        fontSize: fontM.size,
        text: String(i + 1),
        textColor: "#ffffff"
      });
      const textLabel = new g.Label({
        scene,
        x: x + 70,
        y: y + 14,
        width: btnW - 80,
        font: fontS,
        fontSize: fontS.size,
        text: "",
        textColor: COLOR_TEXT,
        lineBreak: false
      });
      scene.append(base);
      scene.append(numTag);
      scene.append(border);
      scene.append(numLabel);
      scene.append(textLabel);
      buttons.push({
        base,
        border,
        numTag,
        numLabel,
        textLabel,
        index: i + 1
      });
    }
    const resultOverlay = new g.FilledRect({
      scene,
      width: g.game.width,
      height: g.game.height,
      cssColor: "#000000",
      opacity: 0.35,
      hidden: true
    });
    const resultLabel = new g.Label({
      scene,
      x: g.game.width / 2,
      y: 250,
      anchorX: 0.5,
      font: fontL,
      fontSize: fontL.size,
      text: "",
      textColor: "#ffffff",
      hidden: true
    });
    const resultSub = new g.Label({
      scene,
      x: g.game.width / 2,
      y: 320,
      anchorX: 0.5,
      font: fontM,
      fontSize: fontM.size,
      text: "",
      textColor: "#ffffff",
      hidden: true
    });
    scene.append(resultOverlay);
    scene.append(resultLabel);
    scene.append(resultSub);
    const endOverlay = new g.FilledRect({
      scene,
      width: g.game.width,
      height: g.game.height,
      cssColor: "#000000",
      opacity: 0.6,
      hidden: true
    });
    const endTitle = new g.Label({
      scene,
      x: g.game.width / 2,
      y: 180,
      anchorX: 0.5,
      font: fontL,
      fontSize: fontL.size,
      text: "結果",
      textColor: "#ffffff",
      hidden: true
    });
    const endScore = new g.Label({
      scene,
      x: g.game.width / 2,
      y: 270,
      anchorX: 0.5,
      font: fontL,
      fontSize: fontL.size,
      text: "SCORE: 0",
      textColor: "#ffffff",
      hidden: true
    });
    const endHint = new g.Label({
      scene,
      x: g.game.width / 2,
      y: 360,
      anchorX: 0.5,
      font: fontM,
      fontSize: fontM.size,
      text: "ランキング登録中…",
      textColor: "#ffffff",
      hidden: true
    });
    scene.append(endOverlay);
    scene.append(endTitle);
    scene.append(endScore);
    scene.append(endHint);
    const stock = loadQuestions(scene);
    const questions = pick10QuestionsWithDistributedCorrectPos(stock, random);
    let totalLeft = TOTAL_TIME;
    let phase = "rule";
    let ruleLeft = RULE_TIME;
    let qIndex = 0;
    let answerLeft = ANSWER_TIME;
    let resultLeft = 0;
    let current = null;
    let answered = false;
    let selectedIndex = 0;
    let typeElapsed = 0;
    let typeShown = 0;
    function setScore(v) {
      g.game.vars.gameState.score = Math.max(0, Math.floor(v));
      scoreLabel.text = "SCORE: " + g.game.vars.gameState.score;
      scoreLabel.invalidate();
    }
    function addScore(delta) {
      setScore(g.game.vars.gameState.score + delta);
    }
    function setButtonsEnabled(enabled) {
      for (let i = 0; i < buttons.length; ++i) {
        buttons[i].base.touchable = enabled;
        buttons[i].base.opacity = enabled ? 0.98 : 0.6;
        buttons[i].base.modified();
      }
    }
    function resetButtonStyles() {
      for (let i = 0; i < buttons.length; ++i) {
        buttons[i].numTag.cssColor = COLOR_ACCENT;
        buttons[i].numTag.opacity = 0.95;
        buttons[i].numTag.modified();
        buttons[i].border.cssColor = COLOR_BORDER;
        buttons[i].border.modified();
      }
    }
    function highlightChoice(idx, ok) {
      const b = buttons[idx - 1];
      b.numTag.cssColor = ok ? COLOR_GREEN : COLOR_ACCENT;
      b.numTag.opacity = 1;
      b.numTag.modified();
      b.border.cssColor = ok ? COLOR_GREEN : COLOR_ACCENT;
      b.border.modified();
    }
    function startQuestion() {
      if (qIndex >= QUESTION_COUNT) {
        startEnd();
        return;
      }
      phase = "quiz";
      current = questions[qIndex];
      answered = false;
      selectedIndex = 0;
      answerLeft = ANSWER_TIME;
      resultLeft = 0;
      qnoLabel.text = "Q " + (qIndex + 1) + "/" + QUESTION_COUNT;
      qnoLabel.invalidate();
      for (let i = 0; i < 6; ++i) {
        buttons[i].textLabel.text = current.choices[i];
        buttons[i].textLabel.invalidate();
      }
      resetButtonStyles();
      setButtonsEnabled(true);
      typeElapsed = 0;
      typeShown = 0;
      questionLabel.text = "";
      questionLabel.invalidate();
    }
    function showResult(isCorrect, reasonText) {
      phase = "result";
      resultLeft = RESULT_TIME;
      setButtonsEnabled(false);
      resultOverlay.hidden = false;
      resultOverlay.modified();
      resultLabel.hidden = false;
      resultSub.hidden = false;
      resultLabel.text = isCorrect ? "正解！" : "不正解…";
      resultLabel.textColor = isCorrect ? "#a8ffb0" : "#ffd0d0";
      resultLabel.invalidate();
      resultSub.text = reasonText || "";
      resultSub.invalidate();
      highlightChoice(current.correctIndex, true);
      if (!isCorrect && selectedIndex) highlightChoice(selectedIndex, false);
      const seToPlay = isCorrect ? seCorrect : seWrong;
      if (seToPlay) {
        seToPlay.play();
      }
    }
    function answer(idx) {
      if (phase !== "quiz" || answered) return;
      answered = true;
      selectedIndex = idx;
      const isCorrect = idx === current.correctIndex;
      if (isCorrect) {
        const bonus = Math.round(BASE * (answerLeft / ANSWER_TIME) * 0.5);
        addScore(BASE + bonus);
        showResult(true, "+" + (BASE + bonus) + "点");
      } else {
        addScore(-MISS_PENALTY);
        showResult(false, "-" + MISS_PENALTY + "点");
      }
    }
    function timeUp() {
      if (phase !== "quiz" || answered) return;
      answered = true;
      selectedIndex = 0;
      addScore(-MISS_PENALTY);
      showResult(false, "時間切れ -" + MISS_PENALTY + "点");
    }
    function startEnd() {
      phase = "end";
      setButtonsEnabled(false);
      endOverlay.hidden = false;
      endTitle.hidden = false;
      endScore.hidden = false;
      endHint.hidden = false;
      endOverlay.modified();
      endTitle.modified();
      endScore.modified();
      endHint.modified();
      endScore.text = "SCORE: " + g.game.vars.gameState.score;
      endScore.invalidate();
      if (bgmPlayer) {
        bgmPlayer.stop();
      }
      if (g.game.requestSaveScore) {
        g.game.requestSaveScore(g.game.vars.gameState.score);
      }
    }
    for (let i = 0; i < buttons.length; ++i) {
      const idx = i + 1;
      buttons[i].base.onPointDown.add(() => answer(idx));
    }
    scene.onUpdate.add(() => {
      const kb = g.game.keyboard;
      if (!kb) return;
      if (phase !== "quiz" || answered) return;
      for (let code = 49; code <= 54; ++code) {
        if (kb.getKeyDown(code)) {
          answer(code - 48);
          break;
        }
      }
    });
    scene.append(overlay);
    scene.append(rulePanel);
    scene.append(ruleBorder);
    scene.append(ruleTitle);
    ruleLineLabels.forEach(label => scene.append(label));
    scene.append(ruleCountdown);
    setButtonsEnabled(false);
    scene.onUpdate.add(() => {
      const dt = 1 / g.game.fps;
      if (phase !== "end") {
        totalLeft -= dt;
        if (totalLeft < 0) totalLeft = 0;
        totalTimeLabel.text = "TIME " + pad2(Math.ceil(totalLeft));
        totalTimeLabel.invalidate();
      }
      if (phase === "rule") {
        ruleLeft -= dt;
        if (ruleLeft < 0) ruleLeft = 0;
        ruleCountdown.text = "開始まで " + Math.ceil(ruleLeft);
        ruleCountdown.invalidate();
        barFill.width = barW;
        barFill.modified();
        if (ruleLeft <= 0) {
          overlay.destroy();
          rulePanel.destroy();
          ruleBorder.destroy();
          ruleTitle.destroy();
          ruleLineLabels.forEach(label => label.destroy());
          ruleCountdown.destroy();
          startQuestion();
        }
        return;
      }
      if (phase === "quiz") {
        typeElapsed += dt;
        const full = current.text;
        const ratio = clamp(typeElapsed / TYPE_TOTAL_SEC, 0, 1);
        const want = Math.floor(full.length * ratio);
        if (want !== typeShown) {
          typeShown = want;
          questionLabel.text = full.slice(0, typeShown);
          questionLabel.invalidate();
        }
        answerLeft -= dt;
        if (answerLeft < 0) answerLeft = 0;
        barFill.width = Math.floor(barW * (answerLeft / ANSWER_TIME));
        barFill.modified();
        if (answerLeft <= 0) timeUp();
        return;
      }
      if (phase === "result") {
        resultLeft -= dt;
        if (resultLeft <= 0) {
          resultOverlay.hidden = true;
          resultLabel.hidden = true;
          resultSub.hidden = true;
          resultOverlay.modified();
          resultLabel.modified();
          resultSub.modified();
          qIndex++;
          startQuestion();
        }
        return;
      }
    });
    scene.onUpdate.add(() => {
      if (phase === "end") return;
      if (totalLeft <= 0) startEnd();
    });
  });
  g.game.pushScene(scene);
}
exports.main = main;
})(g.module.exports, g.module.require, g.module, g.filename, g.dirname);
}