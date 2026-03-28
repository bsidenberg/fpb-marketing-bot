import sharp from 'sharp';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

const FORMAT_SPECS = {
  feed:     { width: 1200, height: 628  },  // 1.91:1 standard link ad
  story:    { width: 1080, height: 1920 },  // 9:16 stories & reels
  square:   { width: 1080, height: 1080 },  // 1:1 feed square
  original: null,                            // no resize
};

const FONT_SIZES = { small: 32, medium: 48, large: 64 };

function buildOverlaySvg(text, position, style, width, height, fontSize) {
  const stripHeight = Math.round(fontSize * 2.5);
  const bgColor     = style === 'light' ? '#000000' : '#ffffff';
  const textColor   = style === 'light' ? '#ffffff'  : '#1a1a1a';

  let yStrip;
  if (position === 'top')    yStrip = 0;
  else if (position === 'bottom') yStrip = height - stripHeight;
  else                            yStrip = Math.round((height - stripHeight) / 2);

  const textY = yStrip + Math.round(stripHeight / 2) + Math.round(fontSize * 0.35);

  // Escape XML special chars
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="${yStrip}" width="${width}" height="${stripHeight}" fill="${bgColor}" fill-opacity="0.72"/>
  <text
    x="${Math.round(width / 2)}"
    y="${textY}"
    font-family="Arial, sans-serif"
    font-size="${fontSize}"
    font-weight="700"
    fill="${textColor}"
    text-anchor="middle"
    dominant-baseline="auto"
  >${safe}</text>
</svg>`;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { imageData, format = 'feed', overlays = [] } = req.body || {};

  if (!imageData?.base64) {
    return res.status(400).json({ success: false, error: 'Missing imageData.base64' });
  }
  if (!FORMAT_SPECS.hasOwnProperty(format)) {
    return res.status(400).json({ success: false, error: `Unknown format: ${format}` });
  }

  try {
    const inputBuffer = Buffer.from(imageData.base64, 'base64');
    let pipeline = sharp(inputBuffer);

    const spec = FORMAT_SPECS[format];
    let outWidth, outHeight;

    if (spec) {
      pipeline = pipeline.resize(spec.width, spec.height, { fit: 'cover', position: 'center' });
      outWidth  = spec.width;
      outHeight = spec.height;
    } else {
      // original — get dimensions from metadata
      const meta = await sharp(inputBuffer).metadata();
      outWidth  = meta.width;
      outHeight = meta.height;
    }

    // Apply text overlays
    if (Array.isArray(overlays) && overlays.length > 0) {
      const composites = overlays.map(ov => {
        const fontSize   = FONT_SIZES[ov.fontSize] || FONT_SIZES.medium;
        const svgString  = buildOverlaySvg(
          ov.text || '',
          ov.position || 'bottom',
          ov.style    || 'light',
          outWidth, outHeight, fontSize
        );
        return { input: Buffer.from(svgString), top: 0, left: 0 };
      });
      pipeline = pipeline.composite(composites);
    }

    const outputBuffer = await pipeline.jpeg({ quality: 90 }).toBuffer();
    const base64Out    = outputBuffer.toString('base64');
    const fileSizeKB   = Math.round(outputBuffer.length / 1024);

    return res.status(200).json({
      success: true,
      processedImage: {
        base64:    base64Out,
        mediaType: 'image/jpeg',
        format,
        width:     outWidth,
        height:    outHeight,
        fileSizeKB,
      },
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
