import fs from 'node:fs'
import zlib from 'node:zlib'

const outDir = new URL('../public/', import.meta.url)

const colors = {
  line: [6, 199, 85, 255],
  white: [255, 255, 255, 255],
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  const crc = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function png(width, height, pixels) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  const rowBytes = width * 4
  const raw = Buffer.alloc((rowBytes + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (rowBytes + 1)
    raw[rowOffset] = 0
    Buffer.from(pixels.buffer, y * rowBytes, rowBytes).copy(raw, rowOffset + 1)
  }

  return Buffer.concat([
    header,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function blendPixel(pixels, width, x, y, color) {
  const i = (y * width + x) * 4
  const a = color[3] / 255
  pixels[i] = Math.round(color[0] * a + pixels[i] * (1 - a))
  pixels[i + 1] = Math.round(color[1] * a + pixels[i + 1] * (1 - a))
  pixels[i + 2] = Math.round(color[2] * a + pixels[i + 2] * (1 - a))
  pixels[i + 3] = 255
}

function roundedRect(x, y, left, top, width, height, radius) {
  const right = left + width
  const bottom = top + height
  if (x < left || x > right || y < top || y > bottom) return false
  const cx = Math.max(left + radius, Math.min(x, right - radius))
  const cy = Math.max(top + radius, Math.min(y, bottom - radius))
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

function polygon(x, y, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function lineDistance(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len))
  const px = x1 + t * dx
  const py = y1 + t * dy
  return Math.hypot(x - px, y - py)
}

function paint(width, height, predicate, color) {
  return (pixels) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const ux = ((x + 0.5) / width) * 64
        const uy = ((y + 0.5) / height) * 64
        if (predicate(ux, uy)) blendPixel(pixels, width, x, y, color)
      }
    }
  }
}

function render(size) {
  const scale = 4
  const width = size * scale
  const height = size * scale
  const pixels = new Uint8ClampedArray(width * height * 4)

  const paints = [
    paint(width, height, (x, y) => roundedRect(x, y, 0, 0, 64, 64, 14), colors.line),
    paint(
      width,
      height,
      (x, y) =>
        roundedRect(x, y, 11, 11, 42, 34, 12) ||
        polygon(x, y, [
          [22, 43],
          [22, 52],
          [34, 43],
        ]),
      colors.white,
    ),
    paint(
      width,
      height,
      (x, y) =>
        lineDistance(x, y, 23, 26, 41, 26) <= 2.25 ||
        lineDistance(x, y, 32, 26, 32, 39) <= 2.25,
      colors.line,
    ),
    paint(
      width,
      height,
      (x, y) =>
        Math.hypot(x - 23, y - 26) <= 5.4 ||
        Math.hypot(x - 41, y - 26) <= 5.4 ||
        Math.hypot(x - 32, y - 39) <= 5.4,
      colors.line,
    ),
    paint(
      width,
      height,
      (x, y) =>
        Math.hypot(x - 23, y - 26) <= 2 ||
        Math.hypot(x - 41, y - 26) <= 2 ||
        Math.hypot(x - 32, y - 39) <= 2,
      colors.white,
    ),
  ]

  for (const draw of paints) draw(pixels)

  const downsampled = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const totals = [0, 0, 0, 0]
      for (let yy = 0; yy < scale; yy += 1) {
        for (let xx = 0; xx < scale; xx += 1) {
          const i = ((y * scale + yy) * width + x * scale + xx) * 4
          totals[0] += pixels[i]
          totals[1] += pixels[i + 1]
          totals[2] += pixels[i + 2]
          totals[3] += pixels[i + 3]
        }
      }
      const o = (y * size + x) * 4
      downsampled[o] = Math.round(totals[0] / 16)
      downsampled[o + 1] = Math.round(totals[1] / 16)
      downsampled[o + 2] = Math.round(totals[2] / 16)
      downsampled[o + 3] = Math.round(totals[3] / 16)
    }
  }
  return png(size, size, downsampled)
}

function icoFromPng(pngBuffer, size) {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header[6] = size
  header[7] = size
  header[8] = 0
  header[9] = 0
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(pngBuffer.length, 14)
  header.writeUInt32LE(22, 18)
  return Buffer.concat([header, pngBuffer])
}

const faviconPng = render(64)
fs.writeFileSync(new URL('favicon.ico', outDir), icoFromPng(faviconPng, 64))
fs.writeFileSync(new URL('apple-touch-icon.png', outDir), render(180))
