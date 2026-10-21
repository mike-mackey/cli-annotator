// File input and download helpers. Nothing here leaves the browser.
export function readFiles(fileList) {
  return Promise.all([...fileList].map(async f => ({ name: f.name, text: await f.text() })));
}

export function baseName(name) {
  return name.replace(/\.[^./\\]+$/, '');
}

export function download(fileName, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
