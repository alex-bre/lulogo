// Read an image File into a self-contained data URL plus its natural size.
export function fileToImageData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const href = reader.result
      const img = new Image()
      img.onload = () => resolve({ href, width: img.naturalWidth || 0, height: img.naturalHeight || 0 })
      img.onerror = reject
      img.src = href
    }
    reader.readAsDataURL(file)
  })
}
