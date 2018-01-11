'use strict';

const path = require('path');

const co = require('co');
const execa = require('execa');
const fs = require('fs-extra');
const Handlebars = require('handlebars');

const utils = require('./utils');
const pkg = require('../package.json');

const context = process.cwd();

function* createOfflinePackage({ rootPath, version, name, description, skipBuild, skipCompress }) {
  const config = yield fs.readJSON(`${rootPath}/config.json`);
  const entry = config.htmls['index.htm'];
  if (!entry) {
    throw new Error(`can't find entry "index.htm" in your config['htmls']`);
  }
  const nowaBuildPath = path.resolve(rootPath, 'dist');
  const tmpZipPath = path.resolve(rootPath, 'temp');
  const tmpTarPath = path.resolve(tmpZipPath, config.appid);
  const convertedBasePath = config.basePath.replace(/^\//, '');
  const serverBasePath = path.resolve(tmpTarPath, convertedBasePath);
  const assetsPath = path.resolve(serverBasePath, config.assetsPath || 'assets');
  const entryPath = path.relative(serverBasePath, path.resolve(serverBasePath, entry.replace(/^\//, '')));
  config.entryPath = entryPath ? `/${entryPath}` : '';
  config.version = config.version || version;
  config.name = config.name || name;
  config.description = config.description || description;

  console.log(`remove folder ${tmpZipPath}, since it may populates assets`);
  yield fs.remove(tmpZipPath);
  console.log(`create folder ${assetsPath}`);
  yield fs.ensureDir(assetsPath);
  if (!skipBuild) {
    let commandPrefix;
    switch (process.platform) {
      case 'win32':
        commandPrefix = `set PATH=%PATH%;${path.resolve(context, 'node_modules/.bin')} &&`;
        break;
      default:
        commandPrefix = `export path=${path.resolve(context, 'node_modules/.bin')}:$path ;`;
    }
    const cpPromise = execa.shell(`${commandPrefix} nowa build --publicPath /assets -d ${path.relative(context, nowaBuildPath)}`);
    cpPromise.stdout.pipe(process.stdout);
    yield cpPromise;
  }
  console.log(`copy all file from ${nowaBuildPath}`);
  console.log(`to ${assetsPath}, except htmls`);
  yield utils.copyFolderFiles(nowaBuildPath, assetsPath, name => !/.html?$/.test(name));
  yield Object.keys(config.htmls).map(filename => {
    const htmlDirPath = path.resolve(serverBasePath, config.htmls[filename]);
    console.log(`copy ${filename} to ${htmlDirPath}`);
    return Promise.all([fs.ensureDir(htmlDirPath), fs.copy(`${rootPath}/${filename}`, `${htmlDirPath}/${filename}`)]);
  });

  const hpmFileSource = yield fs.readFile(`${__dirname}/templates/hpmfile.json.hbs`, { encoding: 'utf-8' });
  const hpmString = Handlebars.compile(hpmFileSource)(config);
  const hpmJSON = Object.assign(JSON.parse(hpmString), config.hpmAssign || {});
  console.log(`generate hpmfile.json to ${tmpTarPath}/hpmfile.json`);
  yield fs.writeJSON(`${tmpTarPath}/hpmfile.json`, hpmJSON);

  const manifestFileSource = yield fs.readFile(`${__dirname}/templates/Manifest.xml.hbs`, { encoding: 'utf-8' });
  const manifestString = Handlebars.compile(manifestFileSource)(config);
  console.log(`generate Manifest.xml to ${tmpZipPath}/Manifest.xml`);
  yield fs.writeFile(`${tmpZipPath}/Manifest.xml`, manifestString);

  if (skipCompress) {
    return 'Finished!';
  }

  yield utils.createTar(tmpTarPath, `${tmpZipPath}/${config.appid}.tar`);
  yield utils.createZip(tmpZipPath, `${rootPath}/${config.version}.amr`);
  return 'Finished!';
}

module.exports = {
  description: pkg.description,

  options: [['-p, --path [path]', 'offline package html/config', 'offline'], ['-s, --skipBuild', 'skip nowa build', false], ['-c, --skipCompress', 'skip compress', false]],

  action: function(options) {
    let version;
    let name;
    let description;
    try {
      const json = require(`${context}/package.json`);
      name = json.name;
      version = json.version;
      description = json.description;
    } catch (e) {
      console.error(`Can't locale package.json in ${context}, you should run nowa offline in a valid project`);
      process.exit(1);
    }
    if (version) {
      const npmVersion = /^\d+\.\d+\.\d+/.exec(version);
      const date = new Date();
      if (npmVersion || npmVersion[0]) {
        version = `${npmVersion[0]}.${date.getFullYear()}${date.getMonth() + 1}${date.getDate()}${date.getHours()}${date.getMinutes()}`;
      }
    }
    const rootPath = path.resolve(context, options.path);
    co(createOfflinePackage({ rootPath, version, name, description, skipBuild: options.skipBuild, skipCompress: options.skipCompress })).then(console.log, console.error);
  },
};
