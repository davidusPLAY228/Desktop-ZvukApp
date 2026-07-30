const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
// const webpack = require("webpack");

module.exports = {
  packagerConfig: {
    asar: true,
    icon: "assets/icons/music-player.ico",
    // Файлы, которые должны лежать ВНЕ asar-архива — как реальные файлы.
    // Иконка трея должна быть реальным файлом, чтобы Windows API мог её прочитать.
    // После сборки она будет в: resources/music-player.ico
    extraResource: [
      "assets/icons/music-player.ico",
      "assets/icons/music-player 512x512.png",
      "assets/icons/music-player.png",
      "assets/icons/music-player.icns",
      "music-player.ico"
    ],
    // Глобально указываем, какие файлы НЕ упаковывать в asar (альтернативный способ)
    // asarUnpack: [
    //   "music-player.ico",
    // ],
  },
  publishers:[
    {
      name:"@electron-forge/publisher-github",
      config:{
        repository:{
          owner: "davidusPLAY228",
          name: "Desktop-ZvukApp"
        },
        authToken: process.env.GITHUB_TOKEN,
      }
    }
  ],
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        setupIcon: 'music-player.ico',
        iconUrl: 'https://raw.githubusercontent.com/davidusPLAY228/Desktop-ZvukApp/main/assets/icons/music-player.ico',
        ...(process.env.WINDOWS_CERT_FILE && process.env.CERT_PASS ? {
          certificateFile: process.env.WINDOWS_CERT_FILE,
          certificatePassword: process.env.CERT_PASS,
        } : {}),
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        icon:'assets/icons/music-player.png',
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // new webpack.EnvironmentPlugin({

    // })
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
