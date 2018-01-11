const path = require('path');

const fs = require('fs-extra');
const JSZip = require('jszip');
const archiver = require('archiver');

exports.createZip = function*(basePath, target) {
  const zip = new JSZip();
  const addFile = dir => {
    fs.readdirSync(dir).forEach(file => {
      const filePath = `${dir}/${file}`;
      if (fs.statSync(filePath).isDirectory()) {
        addFile(filePath);
      } else {
        zip.file(path.relative(basePath, filePath), fs.readFileSync(`${dir}/${file}`));
      }
    });
  };
  addFile(basePath);
  return new Promise((resolve, reject) => {
    try {
      const wStream = fs.createWriteStream(target);
      wStream.on('error', reject);
      zip
        .generateNodeStream({
          streamFiles: true,
          compression: 'DEFLATE',
        })
        .on('error', reject)
        .pipe(wStream)
        .on('close', resolve);
    } catch (err) {
      reject(err);
    }
  });
};

exports.createTar = function*(basePath, target) {
  yield new Promise((resolve, reject) => {
    const archiveFile = archiver('tar', {});
    const wStream = fs.createWriteStream(target);
    archiveFile.on('error', reject);
    wStream.on('error', reject);
    wStream.on('close', resolve);
    archiveFile.pipe(wStream);
    const subs = fs.readdirSync(basePath);
    for (const f of subs) {
      const _p = path.resolve(basePath, f);
      const _stat = fs.lstatSync(_p);
      if (_stat.isDirectory()) {
        archiveFile.directory(_p, f);
      } else if (_stat.isFile()) {
        archiveFile.file(_p, { name: f });
      }
    }
    archiveFile.finalize();
  });
};


exports.copyFolderFiles = function* copyFolderFiles(from, to, filter = name => true) {
  const subs = yield fs.readdir(from);
  const results = yield subs.map(name => ({ name: name, path: path.resolve(from, name), stats: fs.stat(path.resolve(from, name)) }));
  for (const r of results) {
    if (r.stats.isFile()) {
      if (filter(r.path)) {
        yield fs.copy(r.path, path.resolve(to, r.name));
      }
    }
    if (r.stats.isDirectory()) {
      yield copyFolderFiles(r.path, to, filter);
    }
  }
};
