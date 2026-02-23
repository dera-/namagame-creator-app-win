window.gLocalAssetContainer["_bootstrap"] = function(g) { (function(exports, require, module, __filename, __dirname) {
const main_1 = require("./main");
module.exports = originalParam => {
  const param = {};
  Object.keys(originalParam).forEach(key => {
    param[key] = originalParam[key];
  });
  // セッションパラメーター
  param.sessionParameter = {};
  // 乱数生成器
  param.random = g.game.random;
  const limitTickToWait = 3; // セッションパラメーターが来るまでに待つtick数
  const scene = new g.Scene({
    game: g.game
  });
  // セッションパラメーターを受け取ってゲームを開始します
  scene.onMessage.add(msg => {
    if (msg.data && msg.data.type === "start" && msg.data.parameters) {
      param.sessionParameter = msg.data.parameters; // sessionParameterフィールドを追加
      if (msg.data.parameters.randomSeed != null) {
        param.random = new g.XorshiftRandomGenerator(msg.data.parameters.randomSeed);
      }
      g.game.popScene();
      main_1.main(param);
    }
  });
  scene.onLoad.add(() => {
    let currentTickCount = 0;
    scene.onUpdate.add(() => {
      currentTickCount++;
      // 待ち時間を超えた場合はゲームを開始します
      if (currentTickCount > limitTickToWait) {
        g.game.popScene();
        main_1.main(param);
      }
    });
  });
  g.game.pushScene(scene);
};
})(g.module.exports, g.module.require, g.module, g.filename, g.dirname);
}