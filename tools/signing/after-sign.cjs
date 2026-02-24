module.exports = async function afterSign(context) {
  if (process.env.SIGNING_MODE !== "production") {
    return;
  }

  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    throw new Error(
      "Production macOS signing requires APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID."
    );
  }

  let notarize;
  try {
    ({ notarize } = require("@electron/notarize"));
  } catch {
    throw new Error("Install @electron/notarize to enable production notarization.");
  }

  await notarize({
    appPath: `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`,
    appleId,
    appleIdPassword,
    teamId,
  });
};
