window.gLocalAssetContainer["main"] = function(g) { (function(exports, require, module, __filename, __dirname) {
module.exports.main = function main(param) {
  const scene = new g.Scene({
    game: g.game,
    assetPaths: ["/image/niconico_tramp.png"],
    name: "main"
  });

  // セッションパラメータに制限時間が指定されていれば利用する
  let timeLimit = 120;
  if (param.sessionParameter && param.sessionParameter.totalTimeLimit != null) {
    timeLimit = param.sessionParameter.totalTimeLimit;
  }

  // ランキング用スコア
  g.game.vars.gameState = {
    score: 0
  };
  scene.onLoad.add(() => {
    const sheet = scene.asset.getImageById("niconico_tramp");
    const font = new g.DynamicFont({
      game: g.game,
      fontFamily: "sans-serif",
      size: 32
    });
    const infoFont = new g.DynamicFont({
      game: g.game,
      fontFamily: "sans-serif",
      size: 22
    });
    const playArea = new g.FilledRect({
      scene: scene,
      x: 0,
      y: 0,
      width: g.game.width,
      height: g.game.height,
      cssColor: "rgba(0,0,0,0)",
      touchable: true
    });
    scene.append(playArea);
    const scoreLabel = new g.Label({
      scene: scene,
      text: "SCORE: 0",
      font: font,
      fontSize: 24,
      textColor: "#222"
    });
    scene.append(scoreLabel);
    const moveLabel = new g.Label({
      scene: scene,
      text: "MOVES: 0",
      font: font,
      fontSize: 24,
      textColor: "#222",
      x: 220
    });
    scene.append(moveLabel);
    const timeLabel = new g.Label({
      scene: scene,
      text: "TIME: " + timeLimit,
      font: font,
      fontSize: 24,
      textColor: "#222",
      x: 440
    });
    scene.append(timeLabel);
    const helpLabel = new g.Label({
      scene: scene,
      text: "K→Aで交互色を並べ、A→Kで組札へ(空き枠ならどこでもOK)。山札をタップしてカードをめくる",
      font: infoFont,
      fontSize: 20,
      textColor: "#444",
      x: 20,
      y: 40
    });
    scene.append(helpLabel);
    const cardWidth = 205;
    const cardHeight = 332;
    const marginX = 26;
    const marginY = 21;
    const gapX = 6;
    const gapY = 10;
    const displayWidth = 82;
    const displayHeight = 133;
    const displayGapX = 12;
    const tableauOffsetY = 36;
    const startX = 20;
    const suits = ["spade", "diamond", "club", "heart"];
    const suitRows = {
      spade: 0,
      diamond: 1,
      club: 2,
      heart: 3
    };
    const suitColors = {
      spade: "black",
      club: "black",
      heart: "red",
      diamond: "red"
    };
    const backSrcX = marginX + 13 * (cardWidth + gapX);
    const backSrcY = marginY + (cardHeight + gapY);
    const stockX = 20;
    const stockY = 70;
    const wasteX = stockX + displayWidth + 20;
    const wasteY = stockY;
    const foundationStartX = wasteX + displayWidth + 40;
    const foundationStartY = stockY;
    const foundationGap = displayWidth + 20;
    const topRowGap = Math.floor(displayHeight / 2);
    const startY = stockY + displayHeight + topRowGap;
    const foundations = suits.map((suit, index) => {
      return {
        suit: null,
        cards: [],
        x: foundationStartX + index * foundationGap,
        y: foundationStartY
      };
    });
    const stockSlot = new g.FilledRect({
      scene: scene,
      x: stockX,
      y: stockY,
      width: displayWidth,
      height: displayHeight,
      cssColor: "#cfd7dd",
      opacity: 0.8,
      touchable: true
    });
    scene.append(stockSlot);
    const wasteSlot = new g.FilledRect({
      scene: scene,
      x: wasteX,
      y: wasteY,
      width: displayWidth,
      height: displayHeight,
      cssColor: "#e9eef2",
      opacity: 0.6
    });
    scene.append(wasteSlot);
    const foundationSlots = [];
    for (let i = 0; i < foundations.length; i++) {
      const slot = new g.FilledRect({
        scene: scene,
        x: foundations[i].x,
        y: foundations[i].y,
        width: displayWidth,
        height: displayHeight,
        cssColor: "#e9eef2",
        opacity: 0.6,
        touchable: true
      });
      scene.append(slot);
      foundationSlots.push(slot);
    }
    const tableauSlots = [];
    for (let i = 0; i < 7; i++) {
      const tx = startX + i * (displayWidth + displayGapX);
      const slot = new g.FilledRect({
        scene: scene,
        x: tx,
        y: startY,
        width: displayWidth,
        height: displayHeight,
        cssColor: "#eef3f6",
        opacity: 0.4,
        touchable: true
      });
      scene.append(slot);
      tableauSlots.push(slot);
    }
    let moves = 0;
    let remainingTime = timeLimit;
    let finished = false;
    const cards = [];
    const stock = [];
    const waste = [];
    const tableau = [[], [], [], [], [], [], []];
    const getEventPoint = ev => {
      if (!ev) return null;
      if (ev.point && typeof ev.point.x === "number" && typeof ev.point.y === "number") {
        return ev.point;
      }
      if (typeof ev.stageX === "number" && typeof ev.stageY === "number") {
        return {
          x: ev.stageX,
          y: ev.stageY
        };
      }
      if (typeof ev.x === "number" && typeof ev.y === "number") {
        return {
          x: ev.x,
          y: ev.y
        };
      }
      if (typeof ev.localX === "number" && typeof ev.localY === "number") {
        return {
          x: ev.localX,
          y: ev.localY
        };
      }
      return null;
    };
    const updateScore = delta => {
      g.game.vars.gameState.score += delta;
      if (g.game.vars.gameState.score < 0) {
        g.game.vars.gameState.score = 0;
      }
      scoreLabel.text = "SCORE: " + g.game.vars.gameState.score;
      scoreLabel.invalidate();
    };
    const updateMoves = () => {
      moves += 1;
      moveLabel.text = "MOVES: " + moves;
      moveLabel.invalidate();
    };
    const getCardSrc = card => {
      if (!card.faceUp) {
        return {
          srcX: backSrcX,
          srcY: backSrcY
        };
      }
      const row = suitRows[card.suit];
      const col = card.rank - 1;
      return {
        srcX: marginX + col * (cardWidth + gapX),
        srcY: marginY + row * (cardHeight + gapY)
      };
    };
    const updateCardSprite = card => {
      const src = getCardSrc(card);
      card.sprite.srcX = src.srcX;
      card.sprite.srcY = src.srcY;
      card.sprite.modified();
    };
    const showCard = card => {
      card.sprite.show();
    };
    const hideCard = card => {
      card.sprite.hide();
    };
    const clearSelection = () => {
      if (!selected) return;
      selected.cards.forEach(card => {
        card.sprite.opacity = 1;
        card.sprite.modified();
      });
      selected = null;
    };
    const setSelection = (cardsToSelect, fromType, fromIndex, fromCol) => {
      clearSelection();
      selected = {
        cards: cardsToSelect,
        fromType: fromType,
        fromIndex: fromIndex,
        fromCol: fromCol
      };
      selected.cards.forEach(card => {
        card.sprite.opacity = 0.7;
        card.sprite.modified();
      });
    };
    const isValidSequence = cardsToCheck => {
      if (cardsToCheck.length <= 1) return true;
      for (let i = 0; i < cardsToCheck.length - 1; i++) {
        const a = cardsToCheck[i];
        const b = cardsToCheck[i + 1];
        if (suitColors[a.suit] === suitColors[b.suit]) return false;
        if (a.rank !== b.rank + 1) return false;
      }
      return true;
    };
    const layoutTableauColumn = colIndex => {
      const column = tableau[colIndex];
      for (let i = 0; i < column.length; i++) {
        const card = column[i];
        card.sprite.x = startX + colIndex * (displayWidth + displayGapX);
        card.sprite.y = startY + i * tableauOffsetY;
        card.sprite.modified();
        showCard(card);
        scene.append(card.sprite);
      }
    };
    const layoutFoundations = () => {
      for (let i = 0; i < foundations.length; i++) {
        const pile = foundations[i];
        for (let j = 0; j < pile.cards.length; j++) {
          const card = pile.cards[j];
          card.sprite.x = pile.x;
          card.sprite.y = pile.y;
          card.sprite.modified();
          showCard(card);
          scene.append(card.sprite);
        }
      }
    };
    const layoutWaste = () => {
      for (let i = 0; i < waste.length; i++) {
        const card = waste[i];
        if (i === waste.length - 1) {
          card.sprite.x = wasteX;
          card.sprite.y = wasteY;
          card.sprite.modified();
          showCard(card);
          scene.append(card.sprite);
        } else {
          hideCard(card);
        }
      }
    };
    const layoutStock = () => {
      for (let i = 0; i < stock.length; i++) {
        const card = stock[i];
        if (i === stock.length - 1) {
          card.sprite.x = stockX;
          card.sprite.y = stockY;
          card.sprite.modified();
          showCard(card);
          scene.append(card.sprite);
        } else {
          hideCard(card);
        }
      }
    };
    const refreshStockVisibility = () => {
      if (stock.length > 0) {
        stockSlot.opacity = 0.9;
      } else {
        stockSlot.opacity = 0.4;
      }
      stockSlot.modified();
    };
    const findCardLocation = card => {
      for (let i = 0; i < tableau.length; i++) {
        const index = tableau[i].indexOf(card);
        if (index >= 0) {
          return {
            type: "tableau",
            col: i,
            index: index
          };
        }
      }
      const wasteIndex = waste.indexOf(card);
      if (wasteIndex >= 0) {
        return {
          type: "waste",
          index: wasteIndex
        };
      }
      for (let i = 0; i < foundations.length; i++) {
        const fIndex = foundations[i].cards.indexOf(card);
        if (fIndex >= 0) {
          return {
            type: "foundation",
            col: i,
            index: fIndex
          };
        }
      }
      const stockIndex = stock.indexOf(card);
      if (stockIndex >= 0) {
        return {
          type: "stock",
          index: stockIndex
        };
      }
      return {
        type: "none",
        index: -1
      };
    };
    const canMoveToFoundation = (card, foundation) => {
      if (foundation.cards.length === 0) {
        return card.rank === 1;
      }
      return foundation.suit === card.suit && card.rank === foundation.cards.length + 1;
    };
    const canMoveToTableau = (card, targetCard) => {
      if (!targetCard) {
        return card.rank === 13;
      }
      if (!targetCard.faceUp) return false;
      return suitColors[card.suit] !== suitColors[targetCard.suit] && card.rank === targetCard.rank - 1;
    };
    const moveCardsToTableau = (cardsToMove, targetCol) => {
      for (let i = 0; i < cardsToMove.length; i++) {
        tableau[targetCol].push(cardsToMove[i]);
      }
      layoutTableauColumn(targetCol);
    };
    const removeCardsFromSource = (cardsToMove, source) => {
      if (source.type === "tableau") {
        tableau[source.col].splice(source.index, cardsToMove.length);
        layoutTableauColumn(source.col);
        const column = tableau[source.col];
        if (column.length > 0) {
          const topCard = column[column.length - 1];
          if (!topCard.faceUp) {
            topCard.faceUp = true;
            updateCardSprite(topCard);
            updateScore(5);
          }
        }
      } else if (source.type === "waste") {
        waste.splice(source.index, cardsToMove.length);
        layoutWaste();
      }
    };
    const checkGameClear = () => {
      let completed = 0;
      for (let i = 0; i < foundations.length; i++) {
        if (foundations[i].cards.length >= 13) {
          completed += 1;
        }
      }
      if (completed === foundations.length) {
        finishGame("COMPLETE!");
      }
    };
    const finishGame = message => {
      if (finished) return;
      finished = true;
      clearSelection();
      const resultLabel = new g.Label({
        scene: scene,
        text: message + " SCORE: " + g.game.vars.gameState.score,
        font: font,
        fontSize: 32,
        textColor: "#b01",
        x: 20,
        y: g.game.height - 80
      });
      scene.append(resultLabel);
      if (g.game.requestSave) {
        g.game.requestSave();
      }
    };
    const tryMoveSelectionToFoundation = foundationIndex => {
      if (!selected || selected.cards.length !== 1) return false;
      const card = selected.cards[0];
      const foundation = foundations[foundationIndex];
      if (!canMoveToFoundation(card, foundation)) return false;
      removeCardsFromSource(selected.cards, {
        type: selected.fromType,
        col: selected.fromCol,
        index: selected.fromIndex
      });
      foundation.cards.push(card);
      if (foundation.suit == null) {
        foundation.suit = card.suit;
      }
      layoutFoundations();
      updateMoves();
      updateScore(10);
      clearSelection();
      checkGameClear();
      return true;
    };
    const tryMoveSelectionToTableau = targetCol => {
      if (!selected) return false;
      const cardsToMove = selected.cards;
      const targetColumn = tableau[targetCol];
      const targetCard = targetColumn.length > 0 ? targetColumn[targetColumn.length - 1] : null;
      if (!canMoveToTableau(cardsToMove[0], targetCard)) {
        return false;
      }
      removeCardsFromSource(cardsToMove, {
        type: selected.fromType,
        col: selected.fromCol,
        index: selected.fromIndex
      });
      moveCardsToTableau(cardsToMove, targetCol);
      updateMoves();
      clearSelection();
      return true;
    };
    const handleStockTap = ev => {
      if (finished) return;
      if (!getEventPoint(ev)) return;
      if (selected) {
        clearSelection();
      }
      if (stock.length > 0) {
        const card = stock.pop();
        card.faceUp = true;
        updateCardSprite(card);
        waste.push(card);
        layoutStock();
        layoutWaste();
        refreshStockVisibility();
        updateMoves();
        return;
      }
      if (stock.length === 0 && waste.length > 0) {
        while (waste.length > 0) {
          const card = waste.pop();
          card.faceUp = false;
          updateCardSprite(card);
          stock.push(card);
        }
        layoutStock();
        refreshStockVisibility();
        updateMoves();
      }
    };
    const handleCardTap = (card, ev) => {
      if (finished) return;
      if (!getEventPoint(ev)) return;
      const location = findCardLocation(card);
      if (location.type === "stock") {
        if (location.index === stock.length - 1) {
          handleStockTap(ev);
        }
        return;
      }
      if (location.type === "foundation") {
        if (selected) {
          if (!tryMoveSelectionToFoundation(location.col)) {
            clearSelection();
          }
        }
        return;
      }
      if (location.type === "tableau") {
        const column = tableau[location.col];
        if (!card.faceUp && location.index === column.length - 1) {
          card.faceUp = true;
          updateCardSprite(card);
          updateMoves();
          updateScore(5);
          return;
        }
        if (selected) {
          if (selected.cards.indexOf(card) >= 0) {
            clearSelection();
            return;
          }
          if (tryMoveSelectionToTableau(location.col)) {
            return;
          }
          clearSelection();
        }
        if (!card.faceUp) return;
        const stack = column.slice(location.index);
        if (!isValidSequence(stack)) return;
        setSelection(stack, "tableau", location.index, location.col);
        return;
      }
      if (location.type === "waste") {
        if (location.index !== waste.length - 1) return;
        if (selected) {
          if (selected.cards[0] === card) {
            clearSelection();
            return;
          }
          clearSelection();
        }
        setSelection([card], "waste", location.index, -1);
        return;
      }
    };
    const createCard = data => {
      const sprite = new g.Sprite({
        scene: scene,
        src: sheet,
        width: displayWidth,
        height: displayHeight,
        srcWidth: cardWidth,
        srcHeight: cardHeight,
        srcX: data.srcX,
        srcY: data.srcY,
        touchable: true
      });
      const card = {
        sprite: sprite,
        suit: data.suit,
        rank: data.rank,
        faceUp: data.faceUp
      };
      sprite.onPointDown.add(ev => {
        handleCardTap(card, ev);
      });
      scene.append(sprite);
      cards.push(card);
      return card;
    };
    const buildDeck = () => {
      const list = [];
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 13; col++) {
          const suit = suits[row];
          const rank = col + 1;
          const srcX = marginX + col * (cardWidth + gapX);
          const srcY = marginY + row * (cardHeight + gapY);
          list.push({
            suit: suit,
            rank: rank,
            srcX: srcX,
            srcY: srcY
          });
        }
      }
      return list;
    };
    const shuffle = list => {
      for (let i = list.length - 1; i > 0; i--) {
        const j = param.random.get(0, i);
        const tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
      }
    };
    const setupGame = () => {
      const deckData = buildDeck();
      shuffle(deckData);
      for (let col = 0; col < 7; col++) {
        for (let i = 0; i <= col; i++) {
          const data = deckData.pop();
          const faceUp = i === col;
          const src = faceUp ? {
            srcX: data.srcX,
            srcY: data.srcY
          } : {
            srcX: backSrcX,
            srcY: backSrcY
          };
          const card = createCard({
            suit: data.suit,
            rank: data.rank,
            faceUp: faceUp,
            srcX: src.srcX,
            srcY: src.srcY
          });
          tableau[col].push(card);
        }
      }
      while (deckData.length > 0) {
        const data = deckData.pop();
        const card = createCard({
          suit: data.suit,
          rank: data.rank,
          faceUp: false,
          srcX: backSrcX,
          srcY: backSrcY
        });
        stock.push(card);
      }
      for (let i = 0; i < tableau.length; i++) {
        layoutTableauColumn(i);
      }
      layoutStock();
      layoutWaste();
      layoutFoundations();
      refreshStockVisibility();
    };
    let selected = null;
    playArea.onPointDown.add(() => {
      if (finished) return;
      clearSelection();
    });
    stockSlot.onPointDown.add(ev => {
      handleStockTap(ev);
    });
    for (let i = 0; i < foundationSlots.length; i++) {
      const index = i;
      foundationSlots[i].onPointDown.add(() => {
        if (finished) return;
        if (!tryMoveSelectionToFoundation(index)) {
          clearSelection();
        }
      });
    }
    for (let i = 0; i < tableauSlots.length; i++) {
      const index = i;
      tableauSlots[i].onPointDown.add(ev => {
        if (finished) return;
        if (!getEventPoint(ev)) return;
        if (!tryMoveSelectionToTableau(index)) {
          clearSelection();
        }
      });
    }
    setupGame();
    scene.onUpdate.add(() => {
      if (finished) return;
      remainingTime -= 1 / g.game.fps;
      if (remainingTime < 0) remainingTime = 0;
      timeLabel.text = "TIME: " + Math.ceil(remainingTime);
      timeLabel.invalidate();
      if (remainingTime <= 0) {
        finishGame("TIME UP");
      }
    });
  });
  g.game.pushScene(scene);
};
})(g.module.exports, g.module.require, g.module, g.filename, g.dirname);
}