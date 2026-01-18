window.gLocalAssetContainer["main"] = function(g) { (function(exports, require, module, __filename, __dirname) {
"use strict";

exports.main = void 0;
function main(param) {
  const INTRO_DURATION = 10;
  const PLAY_DURATION = 90;
  const PER_ORDER_TIME = 10;
  const MAX_PRICE = 100000;
  const MIN_PRICE = 10;
  const STRICT_CUSTOMER_RATE = 0.2;
  const MP_MAX = 100;
  const MP_CONSUME_PER_SEC = 10;
  const MP_RECOVER_PER_SEC = 5;
  const BASE_SCORE_NORMAL = 100;
  const PENALTY_WRONG = -100;
  const PENALTY_TIMEOUT = -100;
  const SMILE_COST = 30;
  const STRICT_SMILE_SUCCESS = 300;
  const STRICT_NO_SMILE_PENALTY = -200;
  const COMBO_STEP = 0.1;
  const COMBO_MAX = 3.0;
  const MONEY_ICON_SIZE = 80;
  const MONEY_ICON_GAP = 18;
  const MONEY_ICON_COLUMNS = 3;
  const MONEY_PANEL_PADDING = 12;
  const EFFECTIVE_FPS = Number.isFinite(g.game.fps) && g.game.fps > 0 ? g.game.fps : 30;
  const DELTA_SEC = 1 / EFFECTIVE_FPS;
  const random = param.random || g.game.random;
  g.game.vars.gameState = {
    score: 0
  };
  g.game.pushScene(createIntroScene());

  // ===== UI helpers (演出用・ゲーム内容は不変) =====
  const UI = {
    colors: {
      bgDark: "#0b1020",
      panelDark: "#0f1730",
      neonCyan: "#2de2e6",
      neonMagenta: "#ff2a6d",
      neonGold: "#ffd166",
      text: "#e8f0ff",
      textDim: "#b7c6ff",
      danger: "#ff4d4d",
      ok: "#2de2a6"
    }
  };
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  function addGlowFrame(scene, x, y, w, h, color, thickness, opacity) {
    const t = thickness;
    const o = opacity;
    const top = new g.FilledRect({
      scene,
      x,
      y,
      width: w,
      height: t,
      cssColor: color,
      opacity: o
    });
    const bottom = new g.FilledRect({
      scene,
      x,
      y: y + h - t,
      width: w,
      height: t,
      cssColor: color,
      opacity: o
    });
    const left = new g.FilledRect({
      scene,
      x,
      y,
      width: t,
      height: h,
      cssColor: color,
      opacity: o
    });
    const right = new g.FilledRect({
      scene,
      x: x + w - t,
      y,
      width: t,
      height: h,
      cssColor: color,
      opacity: o
    });
    scene.append(top);
    scene.append(bottom);
    scene.append(left);
    scene.append(right);
    return {
      top,
      bottom,
      left,
      right
    };
  }
  function addSlitEdges(scene) {
    // 画面端のスリット風（軽量）
    const w = g.game.width;
    const h = g.game.height;
    const left = new g.FilledRect({
      scene,
      x: 0,
      y: 0,
      width: 10,
      height: h,
      cssColor: UI.colors.neonCyan,
      opacity: 0.08
    });
    const right = new g.FilledRect({
      scene,
      x: w - 10,
      y: 0,
      width: 10,
      height: h,
      cssColor: UI.colors.neonMagenta,
      opacity: 0.08
    });
    const top = new g.FilledRect({
      scene,
      x: 0,
      y: 0,
      width: w,
      height: 8,
      cssColor: "#ffffff",
      opacity: 0.04
    });
    const bottom = new g.FilledRect({
      scene,
      x: 0,
      y: h - 8,
      width: w,
      height: 8,
      cssColor: "#ffffff",
      opacity: 0.04
    });
    scene.append(left);
    scene.append(right);
    scene.append(top);
    scene.append(bottom);
    return {
      left,
      right,
      top,
      bottom
    };
  }
  function createRipple(scene, x, y, color) {
    // FilledRectで疑似リップル（四角拡大）
    const r = new g.FilledRect({
      scene,
      x: x - 6,
      y: y - 6,
      width: 12,
      height: 12,
      cssColor: color,
      opacity: 0.25
    });
    scene.append(r);
    const duration = 12;
    let t = 0;
    r.onUpdate.add(() => {
      t++;
      const p = easeOutCubic(clamp(t / duration, 0, 1));
      const size = 12 + 70 * p;
      r.x = x - size / 2;
      r.y = y - size / 2;
      r.width = size;
      r.height = size;
      r.opacity = 0.25 * (1 - p);
      r.modified();
      if (t >= duration) r.destroy();
    });
  }
  function createConfetti(scene, x, y, count) {
    const colors = [UI.colors.neonCyan, UI.colors.neonMagenta, UI.colors.neonGold, UI.colors.ok];
    for (let i = 0; i < count; i++) {
      const c = colors[i % colors.length];
      const p = new g.FilledRect({
        scene,
        x,
        y,
        width: 6,
        height: 6,
        cssColor: c,
        opacity: 0.9
      });
      scene.append(p);
      const vx = random.get(-100, 100) / 100 * 7;
      const vy = -3 - random.get(0, 100) / 100 * 6;
      const rot = random.get(0, 360);
      const life = 18 + random.get(0, 10);
      let t = 0;
      p.angle = rot;
      p.onUpdate.add(() => {
        t++;
        p.x += vx;
        p.y += vy + 0.35 * t;
        p.angle += 18;
        p.opacity = 0.9 * (1 - t / life);
        p.modified();
        if (t >= life) p.destroy();
      });
    }
  }
  function pulseLabel(label, baseScale, peakScale, frames) {
    const duration = frames;
    let t = 0;
    label.scaleX = baseScale;
    label.scaleY = baseScale;
    label.modified();
    // NOTE: onUpdate.add() の戻り値は undefined のため、ハンドラ参照を保持しない
    label.onUpdate.add(() => {
      t++;
      const p = easeOutCubic(clamp(t / duration, 0, 1));
      const s = lerp(peakScale, baseScale, p);
      label.scaleX = s;
      label.scaleY = s;
      label.modified();
      if (t >= duration) {
        // remove() せず、以後は何もしない（軽量）
        label.scaleX = baseScale;
        label.scaleY = baseScale;
        label.modified();
      }
    });
  }
  function bounceEntity(entity, dy, frames) {
    const startY = entity.y;
    let t = 0;
    entity.onUpdate.add(() => {
      if (t >= frames) return;
      t++;
      const p = easeOutCubic(clamp(t / frames, 0, 1));
      entity.y = startY - dy * (1 - p);
      entity.modified();
      if (t === frames) {
        entity.y = startY;
        entity.modified();
      }
    });
  }
  function createToast(scene, font, text, color) {
    const root = new g.E({
      scene,
      x: 0,
      y: 0,
      width: g.game.width,
      height: 80
    });
    const bg = new g.FilledRect({
      scene,
      x: 0,
      y: 0,
      width: g.game.width,
      height: 80,
      cssColor: color,
      opacity: 0.0
    });
    const label = new g.Label({
      scene,
      font,
      fontSize: 30,
      text,
      textColor: "#ffffff",
      x: 24,
      y: 22
    });
    root.append(bg);
    root.append(label);
    scene.append(root);
    const duration = 45;
    let t = 0;
    root.onUpdate.add(() => {
      t++;
      // in 10f, hold 25f, out 10f
      let a = 0;
      if (t <= 10) a = t / 10;else if (t <= 35) a = 1;else a = Math.max(0, 1 - (t - 35) / 10);
      bg.opacity = 0.55 * a;
      bg.modified();
      if (t >= duration) root.destroy();
    });
  }
  function createChatPanel(scene, font) {
    const panelW = 360;
    const panelH = 260;
    const root = new g.E({
      scene,
      x: g.game.width - panelW - 18,
      y: 18,
      width: panelW,
      height: panelH
    });
    const bg = new g.FilledRect({
      scene,
      width: panelW,
      height: panelH,
      cssColor: UI.colors.panelDark,
      opacity: 0.72
    });
    root.append(bg);

    // glow frame (2 layers)
    const frame1 = addGlowFrame(scene, root.x, root.y, panelW, panelH, UI.colors.neonCyan, 2, 0.22);
    const frame2 = addGlowFrame(scene, root.x + 2, root.y + 2, panelW - 4, panelH - 4, UI.colors.neonMagenta, 1, 0.12);
    const title = new g.Label({
      scene,
      font,
      fontSize: 22,
      text: "CHAT",
      textColor: UI.colors.text,
      x: 14,
      y: 10
    });
    root.append(title);
    const lines = [];
    const maxLines = 7;
    for (let i = 0; i < maxLines; i++) {
      const l = new g.Label({
        scene,
        font,
        fontSize: 20,
        text: "",
        textColor: UI.colors.textDim,
        x: 14,
        y: 44 + i * 30
      });
      root.append(l);
      lines.push(l);
    }
    const pushMessage = (msg, important) => {
      for (let i = 0; i < maxLines - 1; i++) {
        lines[i].text = lines[i + 1].text;
        lines[i].textColor = lines[i + 1].textColor;
        lines[i].invalidate();
      }
      lines[maxLines - 1].text = msg;
      lines[maxLines - 1].textColor = important ? UI.colors.neonGold : UI.colors.textDim;
      lines[maxLines - 1].invalidate();
      bounceEntity(root, 10, 10);
    };
    const relayout = () => {
      root.x = g.game.width - panelW - 18;
      root.y = 18;
      root.modified();
      bg.width = panelW;
      bg.height = panelH;
      bg.modified();
      // frame追従
      frame1.top.x = root.x;
      frame1.top.y = root.y;
      frame1.top.width = panelW;
      frame1.top.modified();
      frame1.bottom.x = root.x;
      frame1.bottom.y = root.y + panelH - 2;
      frame1.bottom.width = panelW;
      frame1.bottom.modified();
      frame1.left.x = root.x;
      frame1.left.y = root.y;
      frame1.left.height = panelH;
      frame1.left.modified();
      frame1.right.x = root.x + panelW - 2;
      frame1.right.y = root.y;
      frame1.right.height = panelH;
      frame1.right.modified();
      frame2.top.x = root.x + 2;
      frame2.top.y = root.y + 2;
      frame2.top.width = panelW - 4;
      frame2.top.modified();
      frame2.bottom.x = root.x + 2;
      frame2.bottom.y = root.y + panelH - 3;
      frame2.bottom.width = panelW - 4;
      frame2.bottom.modified();
      frame2.left.x = root.x + 2;
      frame2.left.y = root.y + 2;
      frame2.left.height = panelH - 4;
      frame2.left.modified();
      frame2.right.x = root.x + panelW - 3;
      frame2.right.y = root.y + 2;
      frame2.right.height = panelH - 4;
      frame2.right.modified();
    };
    return {
      root,
      pushMessage,
      relayout
    };
  }
  function createActivityPanel(scene, font) {
    const w = 360;
    const h = 120;
    const root = new g.E({
      scene,
      x: 18,
      y: g.game.height - h - 18,
      width: w,
      height: h
    });
    const bg = new g.FilledRect({
      scene,
      width: w,
      height: h,
      cssColor: UI.colors.panelDark,
      opacity: 0.62
    });
    root.append(bg);
    const title = new g.Label({
      scene,
      font,
      fontSize: 20,
      text: "LIVE",
      textColor: UI.colors.text,
      x: 14,
      y: 10
    });
    root.append(title);
    const viewers = new g.Label({
      scene,
      font,
      fontSize: 22,
      text: "視聴者: 0",
      textColor: UI.colors.textDim,
      x: 14,
      y: 42
    });
    const likes = new g.Label({
      scene,
      font,
      fontSize: 22,
      text: "いいね: 0",
      textColor: UI.colors.textDim,
      x: 14,
      y: 72
    });
    root.append(viewers);
    root.append(likes);
    const glow = addGlowFrame(scene, root.x, root.y, w, h, UI.colors.neonCyan, 2, 0.16);
    let v = 1200 + random.get(0, 800);
    let l = 300 + random.get(0, 400);
    const bump = () => {
      createConfetti(scene, root.x + w - 30, root.y + 20, 10);
      // glow pulse
      glow.top.opacity = 0.28;
      glow.bottom.opacity = 0.28;
      glow.left.opacity = 0.28;
      glow.right.opacity = 0.28;
      glow.top.modified();
      glow.bottom.modified();
      glow.left.modified();
      glow.right.modified();
      let t = 0;
      const dur = 12;
      root.onUpdate.add(() => {
        t++;
        const p = clamp(t / dur, 0, 1);
        const o = lerp(0.28, 0.16, p);
        glow.top.opacity = o;
        glow.bottom.opacity = o;
        glow.left.opacity = o;
        glow.right.opacity = o;
        glow.top.modified();
        glow.bottom.modified();
        glow.left.modified();
        glow.right.modified();
      });
    };
    const tick = () => {
      // たまに増える（ライブ感）
      if (random.get(0, 100) < 6) {
        v += random.get(0, 12);
        l += random.get(0, 6);
        viewers.text = "視聴者: " + v;
        likes.text = "いいね: " + l;
        viewers.invalidate();
        likes.invalidate();
        bump();
      }
    };
    const relayout = () => {
      root.x = 18;
      root.y = g.game.height - h - 18;
      root.modified();
      glow.top.x = root.x;
      glow.top.y = root.y;
      glow.top.width = w;
      glow.top.modified();
      glow.bottom.x = root.x;
      glow.bottom.y = root.y + h - 2;
      glow.bottom.width = w;
      glow.bottom.modified();
      glow.left.x = root.x;
      glow.left.y = root.y;
      glow.left.height = h;
      glow.left.modified();
      glow.right.x = root.x + w - 2;
      glow.right.y = root.y;
      glow.right.height = h;
      glow.right.modified();
    };
    return {
      root,
      tick,
      relayout
    };
  }
  function createMpGauge(scene, x, y, w, h) {
    const root = new g.E({
      scene,
      x,
      y,
      width: w,
      height: h
    });
    const bg = new g.FilledRect({
      scene,
      width: w,
      height: h,
      cssColor: "#000000",
      opacity: 0.35
    });
    const bar = new g.FilledRect({
      scene,
      width: w,
      height: h,
      cssColor: UI.colors.neonCyan,
      opacity: 0.85
    });
    const shine = new g.FilledRect({
      scene,
      width: w,
      height: 2,
      cssColor: "#ffffff",
      opacity: 0.25,
      y: 1
    });
    root.append(bg);
    root.append(bar);
    root.append(shine);
    const setRate = rate => {
      const r = clamp(rate, 0, 1);
      bar.width = Math.max(1, Math.floor(w * r));
      bar.cssColor = r < 0.25 ? UI.colors.danger : UI.colors.neonCyan;
      bar.modified();
    };
    return {
      root,
      setRate
    };
  }
  function createIntroScene() {
    const scene = new g.Scene({
      game: g.game
    });
    scene.onLoad.add(() => {
      const titleFont = new g.DynamicFont({
        game: g.game,
        fontFamily: "sans-serif",
        size: 64
      });
      const ruleFont = new g.DynamicFont({
        game: g.game,
        fontFamily: "sans-serif",
        size: 36
      });

      // 背景を配信っぽく（暗め＋ネオン）
      const introBg = new g.FilledRect({
        scene,
        cssColor: UI.colors.bgDark,
        width: g.game.width,
        height: g.game.height
      });
      scene.append(introBg);

      // うっすらグラデ風の帯
      const band1 = new g.FilledRect({
        scene,
        x: 0,
        y: 0,
        width: g.game.width,
        height: 140,
        cssColor: UI.colors.neonMagenta,
        opacity: 0.08
      });
      const band2 = new g.FilledRect({
        scene,
        x: 0,
        y: 140,
        width: g.game.width,
        height: 140,
        cssColor: UI.colors.neonCyan,
        opacity: 0.06
      });
      scene.append(band1);
      scene.append(band2);
      addSlitEdges(scene);
      addGlowFrame(scene, 18, 18, g.game.width - 36, g.game.height - 36, UI.colors.neonCyan, 2, 0.10);
      const titleShadow = new g.Label({
        scene,
        font: titleFont,
        fontSize: 64,
        text: "お釣りマスター開店準備中",
        textColor: "#000000",
        x: 82,
        y: 84,
        opacity: 0.35
      });
      scene.append(titleShadow);
      const titleLabel = new g.Label({
        scene,
        font: titleFont,
        fontSize: 64,
        text: "お釣りマスター開店準備中",
        textColor: UI.colors.text,
        x: 80,
        y: 80
      });
      scene.append(titleLabel);
      const subtitle = new g.Label({
        scene,
        font: ruleFont,
        fontSize: 28,
        text: "配信現場の熱量を、UIで盛り上げろ！",
        textColor: UI.colors.neonGold,
        x: 84,
        y: 160
      });
      scene.append(subtitle);
      const rules = ["目的: 正しいお釣りを10秒以内に渡そう。遅れると怒られるよ。", "操作: お金アイコンをタップしてお釣り額を加算。", "リセット: 「リセット」で入力を0円に戻せる。", "確定: 「確定」で提示したお釣りを決定。", "笑顔: 「笑顔」ONで得点2倍。OFFだと怒る客もいるよ。"];
      rules.forEach((text, index) => {
        const ruleLabel = new g.Label({
          scene,
          font: ruleFont,
          fontSize: 32,
          text,
          textColor: UI.colors.textDim,
          x: 120,
          y: 230 + index * 56
        });
        scene.append(ruleLabel);
      });
      const countdownLabel = new g.Label({
        scene,
        font: ruleFont,
        fontSize: 40,
        text: "ゲーム開始まで: " + INTRO_DURATION + "秒",
        textColor: UI.colors.text,
        x: 120,
        y: g.game.height - 120
      });
      scene.append(countdownLabel);

      // 起動時の軽いロゴ演出
      pulseLabel(titleLabel, 1.0, 1.06, 18);
      let elapsed = 0;
      let transitioned = false;
      scene.onUpdate.add(() => {
        if (transitioned) return;
        elapsed += DELTA_SEC;
        const remain = Math.max(0, Math.ceil(INTRO_DURATION - elapsed));
        countdownLabel.text = "ゲーム開始まで: " + remain + "秒";
        countdownLabel.invalidate();
        if (remain <= 3 && random.get(0, 100) < 20) {
          createConfetti(scene, 120 + random.get(0, 300), g.game.height - 140, 4);
        }
        if (elapsed >= INTRO_DURATION) {
          transitioned = true;
          g.game.replaceScene(createPlayScene());
        }
      });
    });
    return scene;
  }
  function createPlayScene() {
    const scene = new g.Scene({
      game: g.game,
      assetIds: ["customer_normal_neutral", "customer_normal_happy", "customer_normal_angry", "customer_strict_neutral", "customer_strict_happy", "customer_strict_angry", "coin_1", "coin_5", "coin_10", "coin_50", "coin_100", "coin_500", "bill_1000", "bill_5000", "bill_10000", "bgm_smash_bom", "se_seikai", "se_huseikai"]
    });
    scene.onLoad.add(() => {
      let remainingGameTime = PLAY_DURATION;
      let remainingOrderTime = PER_ORDER_TIME;
      let score = 0;
      let mp = MP_MAX;
      let smileMode = false;
      let isStrictCustomer = false;
      let currentPrice = 0;
      let currentPay = 0;
      let currentChange = 0;
      let inputChange = 0;
      let combo = 0;
      let gameFinished = false;
      const seCorrect = scene.asset.getAudioById("se_seikai");
      const seWrong = scene.asset.getAudioById("se_huseikai");
      const bgm = scene.asset.getAudioById("bgm_smash_bom");
      let bgmPlayer = null;
      if (bgm) {
        bgmPlayer = bgm.play();
        if (bgmPlayer && bgmPlayer.changeVolume) {
          bgmPlayer.changeVolume(0.4);
        }
      }
      const stopBgm = () => {
        if (bgmPlayer && bgmPlayer.stop) {
          bgmPlayer.stop();
          bgmPlayer = null;
        }
      };
      const font = new g.DynamicFont({
        game: g.game,
        fontFamily: "sans-serif",
        size: 40
      });
      const padding = 20;

      // 背景（暗め＋ネオン帯）
      const bg = new g.FilledRect({
        scene,
        cssColor: UI.colors.bgDark,
        width: g.game.width,
        height: g.game.height
      });
      scene.append(bg);
      const bgBandA = new g.FilledRect({
        scene,
        x: 0,
        y: 0,
        width: g.game.width,
        height: 220,
        cssColor: UI.colors.neonMagenta,
        opacity: 0.06
      });
      const bgBandB = new g.FilledRect({
        scene,
        x: 0,
        y: 220,
        width: g.game.width,
        height: 220,
        cssColor: UI.colors.neonCyan,
        opacity: 0.05
      });
      scene.append(bgBandA);
      scene.append(bgBandB);
      addSlitEdges(scene);

      // 中央ビューポート枠（ゲーム内容はそのまま、枠だけ追加）
      const viewportFrame = addGlowFrame(scene, 12, 12, g.game.width - 24, g.game.height - 24, UI.colors.neonCyan, 2, 0.08);
      const setSpriteImage = (sprite, imageAsset) => {
        sprite.src = imageAsset;
        sprite.srcWidth = imageAsset.width;
        sprite.srcHeight = imageAsset.height;
        sprite.invalidate();
      };
      const customerImages = {
        normal: {
          neutral: scene.asset.getImageById("customer_normal_neutral"),
          happy: scene.asset.getImageById("customer_normal_happy"),
          angry: scene.asset.getImageById("customer_normal_angry")
        },
        strict: {
          neutral: scene.asset.getImageById("customer_strict_neutral"),
          happy: scene.asset.getImageById("customer_strict_happy"),
          angry: scene.asset.getImageById("customer_strict_angry")
        }
      };
      const customerSprite = new g.Sprite({
        scene,
        src: customerImages.normal.neutral,
        x: padding,
        y: padding,
        width: 260,
        height: 360,
        srcWidth: customerImages.normal.neutral.width,
        srcHeight: customerImages.normal.neutral.height
      });
      scene.append(customerSprite);

      // 顧客の背面にグロー板
      const customerGlow = new g.FilledRect({
        scene,
        x: customerSprite.x - 8,
        y: customerSprite.y - 8,
        width: customerSprite.width + 16,
        height: customerSprite.height + 16,
        cssColor: UI.colors.neonMagenta,
        opacity: 0.06
      });
      scene.insertBefore(customerGlow, customerSprite);
      const priceLabel = new g.Label({
        scene,
        font,
        fontSize: 32,
        textColor: UI.colors.text,
        x: 420,
        y: 40,
        text: "商品金額: 0円"
      });
      scene.append(priceLabel);
      const payLabel = new g.Label({
        scene,
        font,
        fontSize: 32,
        textColor: UI.colors.text,
        x: 420,
        y: 90,
        text: "支払金額: 0円"
      });
      scene.append(payLabel);
      const changeLabel = new g.Label({
        scene,
        font,
        fontSize: 32,
        textColor: UI.colors.text,
        x: 420,
        y: 140,
        text: "お釣り: 0円"
      });
      scene.append(changeLabel);
      const inputLabel = new g.Label({
        scene,
        font,
        fontSize: 36,
        textColor: UI.colors.neonCyan,
        x: 420,
        y: 210,
        text: "返すお釣り: 0円"
      });
      scene.append(inputLabel);

      // 入力欄のネオン下線
      const inputUnderline = new g.FilledRect({
        scene,
        x: 420,
        y: 252,
        width: 420,
        height: 3,
        cssColor: UI.colors.neonCyan,
        opacity: 0.35
      });
      scene.append(inputUnderline);
      const profitPanel = new g.E({
        scene,
        x: padding - 10,
        y: 450,
        width: 360,
        height: 160
      });
      scene.append(profitPanel);
      const profitBg = new g.FilledRect({
        scene,
        width: profitPanel.width,
        height: profitPanel.height,
        cssColor: UI.colors.panelDark,
        opacity: 0.72
      });
      profitPanel.append(profitBg);

      // ステータス枠のグロー
      const profitGlow = addGlowFrame(scene, profitPanel.x, profitPanel.y, profitPanel.width, profitPanel.height, UI.colors.neonMagenta, 2, 0.16);
      const profitTitle = new g.Label({
        scene,
        font,
        fontSize: 28,
        textColor: UI.colors.text,
        x: 16,
        y: 10,
        text: "ステータス"
      });
      profitPanel.append(profitTitle);
      const scoreLabel = new g.Label({
        scene,
        font,
        fontSize: 32,
        textColor: UI.colors.text,
        x: 16,
        y: 60,
        text: "スコア: 0"
      });
      profitPanel.append(scoreLabel);
      const comboLabel = new g.Label({
        scene,
        font,
        fontSize: 28,
        textColor: UI.colors.textDim,
        x: 16,
        y: 110,
        text: "コンボ: 0 (x1.0)"
      });
      profitPanel.append(comboLabel);
      const timeLabel = new g.Label({
        scene,
        font,
        fontSize: 32,
        textColor: UI.colors.text,
        x: 900,
        y: 40,
        text: "残り時間: " + Math.ceil(remainingGameTime) + "秒"
      });
      scene.append(timeLabel);
      const orderTimeLabel = new g.Label({
        scene,
        font,
        fontSize: 28,
        textColor: UI.colors.textDim,
        x: 900,
        y: 90,
        text: "会計タイム: " + Math.ceil(remainingOrderTime) + "秒"
      });
      scene.append(orderTimeLabel);
      const mpLabel = new g.Label({
        scene,
        font,
        fontSize: 28,
        textColor: UI.colors.textDim,
        x: 900,
        y: 140,
        text: "MP: " + Math.floor(mp)
      });
      scene.append(mpLabel);

      // MPゲージ（数値は既存のまま、表示を追加）
      const mpGauge = createMpGauge(scene, 900, 172, 260, 10);
      scene.append(mpGauge.root);
      const smileLabel = new g.Label({
        scene,
        font,
        fontSize: 32,
        textColor: UI.colors.neonMagenta,
        x: 900,
        y: 190,
        text: "笑顔: OFF"
      });
      scene.append(smileLabel);
      const strictLabel = new g.Label({
        scene,
        font,
        fontSize: 28,
        textColor: UI.colors.neonGold,
        x: 540,
        y: 260,
        text: ""
      });
      scene.append(strictLabel);

      // チャット＆アクティビティ（演出のみ）
      const chat = createChatPanel(scene, font);
      const activity = createActivityPanel(scene, font);

      // 通知バー（イベント時に使用）
      const notifyFont = new g.DynamicFont({
        game: g.game,
        fontFamily: "sans-serif",
        size: 30
      });
      const moneyValues = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000];
      const moneyAssetIds = ["coin_1", "coin_5", "coin_10", "coin_50", "coin_100", "coin_500", "bill_1000", "bill_5000", "bill_10000"];
      const moneyImageAssets = moneyAssetIds.map(id => scene.asset.getImageById(id));
      const moneyPanel = new g.E({
        scene
      });
      const moneyPanelBg = new g.FilledRect({
        scene,
        cssColor: UI.colors.panelDark,
        opacity: 0.72,
        width: 10,
        height: 10
      });
      moneyPanel.append(moneyPanelBg);
      const moneyGroup = new g.E({
        scene,
        x: MONEY_PANEL_PADDING,
        y: MONEY_PANEL_PADDING
      });
      moneyPanel.append(moneyGroup);
      scene.append(moneyPanel);

      // お金パネルのグロー枠
      const moneyPanelGlow = addGlowFrame(scene, 0, 0, 10, 10, UI.colors.neonCyan, 2, 0.14);
      const moneyButtons = moneyValues.map((value, index) => {
        const icon = createMoneyIcon(moneyImageAssets[index], value);
        moneyGroup.append(icon);
        return icon;
      });
      const layoutMoneyIcons = () => {
        moneyButtons.forEach((btn, index) => {
          const col = index % MONEY_ICON_COLUMNS;
          const row = Math.floor(index / MONEY_ICON_COLUMNS);
          btn.x = col * (MONEY_ICON_SIZE + MONEY_ICON_GAP);
          btn.y = row * (MONEY_ICON_SIZE + MONEY_ICON_GAP);
          btn.modified();
        });
      };
      const handleResize = () => {
        // 背景追従
        bg.width = g.game.width;
        bg.height = g.game.height;
        bg.modified();
        bgBandA.width = g.game.width;
        bgBandB.width = g.game.width;
        bgBandB.y = 220;
        bgBandA.modified();
        bgBandB.modified();

        // viewport frame
        viewportFrame.top.width = g.game.width - 24;
        viewportFrame.top.modified();
        viewportFrame.bottom.width = g.game.width - 24;
        viewportFrame.bottom.y = g.game.height - 14;
        viewportFrame.bottom.modified();
        viewportFrame.left.height = g.game.height - 24;
        viewportFrame.left.modified();
        viewportFrame.right.x = g.game.width - 14;
        viewportFrame.right.height = g.game.height - 24;
        viewportFrame.right.modified();
        const rows = Math.ceil(moneyButtons.length / MONEY_ICON_COLUMNS);
        const contentWidth = MONEY_ICON_COLUMNS * MONEY_ICON_SIZE + (MONEY_ICON_COLUMNS - 1) * MONEY_ICON_GAP;
        const contentHeight = rows * MONEY_ICON_SIZE + (rows - 1) * MONEY_ICON_GAP;
        moneyGroup.width = contentWidth;
        moneyGroup.height = contentHeight;
        moneyPanel.width = contentWidth + MONEY_PANEL_PADDING * 2;
        moneyPanel.height = contentHeight + MONEY_PANEL_PADDING * 2;
        moneyPanel.x = Math.max(padding, g.game.width - moneyPanel.width - padding);
        moneyPanel.y = Math.max(260, g.game.height - moneyPanel.height - padding);
        moneyPanel.modified();
        moneyPanelBg.width = moneyPanel.width;
        moneyPanelBg.height = moneyPanel.height;
        moneyPanelBg.modified();

        // money glow frame追従
        moneyPanelGlow.top.x = moneyPanel.x;
        moneyPanelGlow.top.y = moneyPanel.y;
        moneyPanelGlow.top.width = moneyPanel.width;
        moneyPanelGlow.top.modified();
        moneyPanelGlow.bottom.x = moneyPanel.x;
        moneyPanelGlow.bottom.y = moneyPanel.y + moneyPanel.height - 2;
        moneyPanelGlow.bottom.width = moneyPanel.width;
        moneyPanelGlow.bottom.modified();
        moneyPanelGlow.left.x = moneyPanel.x;
        moneyPanelGlow.left.y = moneyPanel.y;
        moneyPanelGlow.left.height = moneyPanel.height;
        moneyPanelGlow.left.modified();
        moneyPanelGlow.right.x = moneyPanel.x + moneyPanel.width - 2;
        moneyPanelGlow.right.y = moneyPanel.y;
        moneyPanelGlow.right.height = moneyPanel.height;
        moneyPanelGlow.right.modified();

        // profit glow追従
        profitGlow.top.x = profitPanel.x;
        profitGlow.top.y = profitPanel.y;
        profitGlow.top.width = profitPanel.width;
        profitGlow.top.modified();
        profitGlow.bottom.x = profitPanel.x;
        profitGlow.bottom.y = profitPanel.y + profitPanel.height - 2;
        profitGlow.bottom.width = profitPanel.width;
        profitGlow.bottom.modified();
        profitGlow.left.x = profitPanel.x;
        profitGlow.left.y = profitPanel.y;
        profitGlow.left.height = profitPanel.height;
        profitGlow.left.modified();
        profitGlow.right.x = profitPanel.x + profitPanel.width - 2;
        profitGlow.right.y = profitPanel.y;
        profitGlow.right.height = profitPanel.height;
        profitGlow.right.modified();
        chat.relayout();
        activity.relayout();
        layoutMoneyIcons();
      };
      handleResize();
      let lastWidth = g.game.width;
      let lastHeight = g.game.height;
      const resetButton = createButton({
        x: 360,
        y: 260,
        width: 150,
        height: 48,
        text: "リセット",
        baseColor: UI.colors.neonMagenta,
        activeColor: "#b31245",
        onClick: () => {
          if (!canOperate()) return;
          inputChange = 0;
          updateInputLabel();
          chat.pushMessage("入力をリセット", false);
        }
      });
      scene.append(resetButton.root);
      let smileButton = null;
      const updateSmileDisplay = () => {
        const status = smileMode ? "ON" : "OFF";
        smileLabel.text = "笑顔: " + status;
        smileLabel.invalidate();
        if (smileButton) {
          smileButton.label.text = "笑顔 " + status;
          smileButton.label.invalidate();
        }
      };
      smileButton = createButton({
        x: 980,
        y: 260,
        width: 200,
        height: 60,
        text: "笑顔 OFF",
        baseColor: UI.colors.neonCyan,
        activeColor: "#0f8f92",
        onClick: ev => {
          if (!canOperate()) return;
          if (!smileMode && mp <= 0) return;
          smileMode = !smileMode;
          updateSmileDisplay();
          if (ev && ev.point) createRipple(scene, smileButton.root.x + ev.point.x, smileButton.root.y + ev.point.y, UI.colors.neonCyan);
          chat.pushMessage(smileMode ? "笑顔モードON!" : "笑顔モードOFF", true);
          createToast(scene, notifyFont, smileMode ? "笑顔ON：得点2倍（MP消費）" : "笑顔OFF：MP回復中", UI.colors.neonCyan);
        }
      });
      scene.append(smileButton.root);
      const submitButton = createButton({
        x: 980,
        y: 330,
        width: 200,
        height: 60,
        text: "確定",
        baseColor: UI.colors.neonGold,
        activeColor: "#caa23a",
        textColor: "#1a1a1a",
        onClick: ev => {
          if (!canOperate()) return;
          if (ev && ev.point) createRipple(scene, submitButton.root.x + ev.point.x, submitButton.root.y + ev.point.y, UI.colors.neonGold);
          judge(false);
        }
      });
      scene.append(submitButton.root);
      function canOperate() {
        return !gameFinished && remainingGameTime > 0 && remainingOrderTime > 0;
      }
      function updateInputLabel() {
        inputLabel.text = "返すお釣り: " + inputChange + "円";
        inputLabel.invalidate();
        pulseLabel(inputLabel, 1.0, 1.05, 10);
      }
      const updateTimeLabels = () => {
        timeLabel.text = "残り時間: " + Math.ceil(Math.max(0, remainingGameTime)) + "秒";
        timeLabel.invalidate();
        orderTimeLabel.text = "会計タイム: " + Math.ceil(Math.max(0, remainingOrderTime)) + "秒";
        orderTimeLabel.invalidate();

        // 残り少ないときに色を変える（可読性優先）
        const danger = remainingOrderTime <= 3;
        orderTimeLabel.textColor = danger ? UI.colors.danger : UI.colors.textDim;
        orderTimeLabel.invalidate();
        if (danger && random.get(0, 100) < 20) {
          createConfetti(scene, orderTimeLabel.x + 220, orderTimeLabel.y + 10, 2);
        }
      };
      const updateMpLabel = () => {
        mpLabel.text = "MP: " + Math.floor(Math.max(0, mp));
        mpLabel.invalidate();
        mpGauge.setRate(mp / MP_MAX);
      };
      function handleMoneyTap(value, x, y) {
        if (!canOperate()) return;
        inputChange += value;
        updateInputLabel();
        if (x != null && y != null) createRipple(scene, x, y, UI.colors.neonMagenta);
      }
      function createMoneyIcon(imageAsset, value) {
        const iconWidth = MONEY_ICON_SIZE;
        const iconHeight = MONEY_ICON_SIZE;
        const container = new g.E({
          scene,
          width: iconWidth,
          height: iconHeight,
          touchable: true
        });
        const hitRect = new g.FilledRect({
          scene,
          width: iconWidth,
          height: iconHeight,
          cssColor: UI.colors.neonCyan,
          opacity: 0.08
        });
        container.append(hitRect);
        const sprite = new g.Sprite({
          scene,
          src: imageAsset,
          width: iconWidth,
          height: iconHeight,
          srcWidth: imageAsset.width,
          srcHeight: imageAsset.height
        });
        container.append(sprite);

        // 角のグロー（軽量）
        const corner = new g.FilledRect({
          scene,
          x: 0,
          y: 0,
          width: iconWidth,
          height: iconHeight,
          cssColor: UI.colors.neonMagenta,
          opacity: 0.0
        });
        container.append(corner);
        const setHighlight = active => {
          hitRect.opacity = active ? 0.22 : 0.08;
          hitRect.modified();
          corner.opacity = active ? 0.08 : 0.0;
          corner.modified();
        };
        let isPressed = false;
        container.onPointDown.add(() => {
          if (!canOperate()) return;
          isPressed = true;
          setHighlight(true);
          const gx = moneyPanel.x + MONEY_PANEL_PADDING + container.x + iconWidth / 2;
          const gy = moneyPanel.y + MONEY_PANEL_PADDING + container.y + iconHeight / 2;
          handleMoneyTap(value, gx, gy);
          bounceEntity(container, 6, 8);
        });
        container.onPointMove.add(ev => {
          if (!isPressed || !ev.point) return;
          const inside = ev.point.x >= 0 && ev.point.x <= iconWidth && ev.point.y >= 0 && ev.point.y <= iconHeight;
          setHighlight(inside);
        });
        container.onPointUp.add(() => {
          if (!isPressed) return;
          isPressed = false;
          setHighlight(false);
        });
        return container;
      }
      function createButton(options) {
        const width = options.width || 180;
        const height = options.height || 60;
        const baseColor = options.baseColor || "#2a76d2";
        const activeColor = options.activeColor || "#1d538f";
        const button = new g.E({
          scene,
          x: options.x,
          y: options.y,
          width,
          height,
          touchable: true
        });

        // glow underlay
        const glow = new g.FilledRect({
          scene,
          x: -4,
          y: -4,
          width: width + 8,
          height: height + 8,
          cssColor: baseColor,
          opacity: 0.12
        });
        button.append(glow);
        const bg = new g.FilledRect({
          scene,
          width,
          height,
          cssColor: baseColor,
          opacity: 0.92
        });
        button.append(bg);
        const fontSize = options.fontSize || 28;
        const label = new g.Label({
          scene,
          font,
          fontSize,
          text: options.text,
          width,
          textAlign: g.TextAlign.Center,
          textColor: options.textColor || "white",
          y: (height - fontSize) / 2
        });
        button.append(label);
        const setActiveState = isActive => {
          bg.cssColor = isActive ? activeColor : baseColor;
          bg.modified();
          glow.opacity = isActive ? 0.22 : 0.12;
          glow.cssColor = isActive ? activeColor : baseColor;
          glow.modified();
        };
        let isPressed = false;
        const isInside = ev => {
          if (!ev || !ev.point) return false;
          return ev.point.x >= 0 && ev.point.x <= width && ev.point.y >= 0 && ev.point.y <= height;
        };
        button.onPointDown.add(ev => {
          isPressed = true;
          setActiveState(true);
          if (ev && ev.point) createRipple(scene, button.x + ev.point.x, button.y + ev.point.y, baseColor);
        });
        button.onPointMove.add(ev => {
          if (!isPressed) return;
          const inside = isInside(ev);
          setActiveState(inside);
        });
        button.onPointUp.add(ev => {
          const inside = isInside(ev);
          setActiveState(false);
          if (isPressed && inside && options.onClick) options.onClick(ev);
          isPressed = false;
        });
        return {
          root: button,
          label,
          bg
        };
      }
      function setStrictState(strict) {
        isStrictCustomer = strict;
        if (strict) {
          setSpriteImage(customerSprite, customerImages.strict.neutral);
          strictLabel.text = "気難しいお客さん! 笑顔必須!";
          createToast(scene, notifyFont, "重要：気難しいお客さん来店！", UI.colors.neonMagenta);
          chat.pushMessage("【重要】気難しいお客さん来た！", true);
          createConfetti(scene, customerSprite.x + 200, customerSprite.y + 40, 10);
        } else {
          setSpriteImage(customerSprite, customerImages.normal.neutral);
          strictLabel.text = "";
        }
        strictLabel.invalidate();
      }
      function generateOrder() {
        currentPrice = MIN_PRICE + Math.floor(random.get(0, MAX_PRICE - MIN_PRICE + 1));
        const pattern = random.get(0, 3);
        let pay = currentPrice;
        if (pattern === 0) {
          pay += random.get(1, 1000);
        } else if (pattern === 1) {
          pay += random.get(1, 501);
        } else {
          const unit = 1000;
          pay = Math.ceil(currentPrice / unit) * unit;
          if (pay === currentPrice) pay += unit;
        }
        currentPay = pay;
        currentChange = currentPay - currentPrice;
        inputChange = 0;
        remainingOrderTime = PER_ORDER_TIME;
        setStrictState(random.get(0, 100) < STRICT_CUSTOMER_RATE * 100);
        priceLabel.text = "商品金額: " + currentPrice + "円";
        priceLabel.invalidate();
        payLabel.text = "支払金額: " + currentPay + "円";
        payLabel.invalidate();
        changeLabel.text = "お釣り: " + currentChange + "円";
        changeLabel.invalidate();
        updateInputLabel();
        updateTimeLabels();
        setNeutralFace();
        chat.pushMessage("注文：" + currentPrice + "円 / 支払：" + currentPay + "円", false);
      }
      function setNeutralFace() {
        if (isStrictCustomer) {
          setSpriteImage(customerSprite, customerImages.strict.neutral);
        } else {
          setSpriteImage(customerSprite, customerImages.normal.neutral);
        }
      }
      function setHappyFace() {
        if (isStrictCustomer) {
          setSpriteImage(customerSprite, customerImages.strict.happy);
        } else {
          setSpriteImage(customerSprite, customerImages.normal.happy);
        }
      }
      function setAngryFace() {
        if (isStrictCustomer) {
          setSpriteImage(customerSprite, customerImages.strict.angry);
        } else {
          setSpriteImage(customerSprite, customerImages.normal.angry);
        }
      }
      function judge(isTimeout) {
        if (gameFinished) return;
        let deltaScore = 0;
        const isCorrect = inputChange === currentChange && !isTimeout;
        if (isTimeout) {
          deltaScore += PENALTY_TIMEOUT;
          combo = 0;
          setAngryFace();
          if (seWrong) seWrong.play();
          createToast(scene, notifyFont, "タイムアウト！", UI.colors.danger);
          chat.pushMessage("タイムアウト…", true);
          createConfetti(scene, customerSprite.x + 220, customerSprite.y + 60, 6);
        } else if (!isCorrect) {
          deltaScore += PENALTY_WRONG;
          combo = 0;
          setAngryFace();
          if (seWrong) seWrong.play();
          createToast(scene, notifyFont, "不正解！", UI.colors.danger);
          chat.pushMessage("不正解…（" + inputChange + "円）", true);
          createConfetti(scene, customerSprite.x + 220, customerSprite.y + 60, 6);
        } else {
          if (isStrictCustomer) {
            if (smileMode) {
              deltaScore += STRICT_SMILE_SUCCESS;
              combo += 2;
            } else {
              deltaScore += STRICT_NO_SMILE_PENALTY;
              combo = 0;
            }
          } else {
            let base = BASE_SCORE_NORMAL;
            const factor = 1 + Math.min(currentPrice / MAX_PRICE, 1);
            base = Math.floor(base * factor);
            if (smileMode) {
              base *= 2;
              base -= SMILE_COST;
            }
            deltaScore += base;
            combo += 1;
          }
          const comboRate = Math.min(1 + combo * COMBO_STEP, COMBO_MAX);
          deltaScore = Math.floor(deltaScore * comboRate);
          setHappyFace();
          if (seCorrect) seCorrect.play();
          createToast(scene, notifyFont, "正解！ +" + deltaScore, UI.colors.ok);
          chat.pushMessage("正解！ +" + deltaScore, true);
          createConfetti(scene, customerSprite.x + 220, customerSprite.y + 60, 14);
        }
        score += deltaScore;
        if (score < 0) score = 0;
        g.game.vars.gameState.score = score;
        scoreLabel.text = "スコア: " + score + (deltaScore !== 0 ? " (" + (deltaScore > 0 ? "+" : "") + deltaScore + ")" : "");
        scoreLabel.invalidate();
        pulseLabel(scoreLabel, 1.0, 1.06, 12);
        const comboRateDisp = Math.min(1 + combo * COMBO_STEP, COMBO_MAX).toFixed(1);
        comboLabel.text = "コンボ: " + combo + " (x" + comboRateDisp + ")";
        comboLabel.invalidate();
        if (combo >= 3) {
          comboLabel.textColor = UI.colors.neonGold;
          comboLabel.invalidate();
        } else {
          comboLabel.textColor = UI.colors.textDim;
          comboLabel.invalidate();
        }
        generateOrder();
      }
      const finishGame = () => {
        if (gameFinished) return;
        gameFinished = true;
        stopBgm();
        g.game.replaceScene(createResultScene(score));
      };
      generateOrder();
      updateMpLabel();
      updateSmileDisplay();
      scene.onUpdate.add(() => {
        if (gameFinished) return;
        if (lastWidth !== g.game.width || lastHeight !== g.game.height) {
          lastWidth = g.game.width;
          lastHeight = g.game.height;
          handleResize();
        }
        remainingGameTime = Math.max(0, remainingGameTime - DELTA_SEC);
        remainingOrderTime = Math.max(0, remainingOrderTime - DELTA_SEC);
        if (smileMode) {
          mp -= MP_CONSUME_PER_SEC * DELTA_SEC;
          if (mp <= 0) {
            mp = 0;
            smileMode = false;
            updateSmileDisplay();
            createToast(scene, notifyFont, "MP切れ：笑顔OFF", UI.colors.danger);
            chat.pushMessage("MP切れで笑顔OFF", true);
          }
        } else {
          mp = Math.min(MP_MAX, mp + MP_RECOVER_PER_SEC * DELTA_SEC);
        }
        updateTimeLabels();
        updateMpLabel();
        activity.tick();
        if (remainingOrderTime <= 0) {
          judge(true);
        }
        if (remainingGameTime <= 0) {
          finishGame();
        }
      });
    });
    return scene;
  }
  function createResultScene(finalScore) {
    const scene = new g.Scene({
      game: g.game
    });
    scene.onLoad.add(() => {
      const font = new g.DynamicFont({
        game: g.game,
        fontFamily: "sans-serif",
        size: 52
      });
      const bg = new g.FilledRect({
        scene,
        cssColor: UI.colors.bgDark,
        width: g.game.width,
        height: g.game.height
      });
      scene.append(bg);
      const band = new g.FilledRect({
        scene,
        x: 0,
        y: 0,
        width: g.game.width,
        height: 200,
        cssColor: UI.colors.neonCyan,
        opacity: 0.06
      });
      scene.append(band);
      addSlitEdges(scene);
      addGlowFrame(scene, 18, 18, g.game.width - 36, g.game.height - 36, UI.colors.neonMagenta, 2, 0.10);
      const titleShadow = new g.Label({
        scene,
        font,
        fontSize: 60,
        text: "リザルト",
        textColor: "#000000",
        x: 402,
        y: 122,
        opacity: 0.35
      });
      scene.append(titleShadow);
      const title = new g.Label({
        scene,
        font,
        fontSize: 60,
        text: "リザルト",
        textColor: UI.colors.text,
        x: 400,
        y: 120
      });
      scene.append(title);
      const scoreLine = new g.Label({
        scene,
        font,
        fontSize: 48,
        text: "スコア: " + finalScore,
        textColor: UI.colors.neonGold,
        x: 400,
        y: 220
      });
      scene.append(scoreLine);
      pulseLabel(scoreLine, 1.0, 1.08, 18);
      const thanks = new g.Label({
        scene,
        font,
        fontSize: 36,
        text: "ご来店ありがとうございました!",
        textColor: UI.colors.textDim,
        x: 320,
        y: 320
      });
      scene.append(thanks);

      // 祝砲
      for (let i = 0; i < 3; i++) {
        createConfetti(scene, 420 + i * 160, 200, 18);
      }
    });
    return scene;
  }
}
exports.main = main;
})(g.module.exports, g.module.require, g.module, g.filename, g.dirname);
}