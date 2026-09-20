// jsdom implements Blob/File without the promise-returning readers the browser
// has had for years (`blob.text()`, `blob.arrayBuffer()`), which the import path
// uses to read a dropped file. Back them with FileReader — which jsdom does
// implement — so tests can hand the app real File objects.
const read = (blob, method) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(reader.result)
    reader[method](blob)
  })

if (typeof Blob !== 'undefined') {
  if (!Blob.prototype.text) {
    Blob.prototype.text = function () {
      return read(this, 'readAsText')
    }
  }
  if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function () {
      return read(this, 'readAsArrayBuffer')
    }
  }
}
