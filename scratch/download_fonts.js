import fs from 'fs';
import path from 'path';
import https from 'https';

const FONTS_DIR = path.resolve('src/assets/fonts');

if (!fs.existsSync(FONTS_DIR)) {
  fs.mkdirSync(FONTS_DIR, { recursive: true });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(new URL(res.headers.location, url).href).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(new URL(res.headers.location, url).href, destPath).then(resolve).catch(reject);
        return;
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function processFontCss(cssUrl, outputCssName) {
  console.log(`Fetching CSS from: ${cssUrl}`);
  let cssText = await fetchText(cssUrl);

  const urlRegex = /url\(['"]?(https:\/\/[^)'"]+)['"]?\)/g;
  let match;
  const urls = [];
  while ((match = urlRegex.exec(cssText)) !== null) {
    urls.push(match[1]);
  }

  console.log(`Found ${urls.length} font files to download.`);

  for (let i = 0; i < urls.length; i++) {
    const fontUrl = urls[i];
    const extension = path.extname(new URL(fontUrl).pathname) || '.woff2';
    const filename = `${outputCssName.replace('.css', '')}_font_${i}${extension}`;
    const destPath = path.join(FONTS_DIR, filename);

    console.log(`Downloading (${i + 1}/${urls.length}): ${fontUrl} -> ${filename}`);
    try {
      await downloadFile(fontUrl, destPath);
      cssText = cssText.replace(fontUrl, `./${filename}`);
    } catch (err) {
      console.error(`Failed to download ${fontUrl}:`, err);
    }
  }

  const cssPath = path.join(FONTS_DIR, outputCssName);
  fs.writeFileSync(cssPath, cssText, 'utf8');
  console.log(`Saved CSS file: ${cssPath}`);
}

async function main() {
  try {
    // We use sjtug.sjtu.edu.cn as a reliable educational domestic mirror for Google Fonts
    const fontsMirrorUrl = 'https://fonts.sjtug.sjtu.edu.cn/css2?family=Literata:ital,opsz,wght@0,7..72,200..900;1,7..72,200..900&family=Nunito+Sans:ital,opsz,wght@0,6..12,200..1000;1,6..12,200..1000&family=Noto+Serif:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';
    const iconsMirrorUrl = 'https://fonts.sjtug.sjtu.edu.cn/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap';

    await processFontCss(fontsMirrorUrl, 'fonts.css');
    await processFontCss(iconsMirrorUrl, 'material-symbols.css');
    console.log('All fonts and icons downloaded successfully!');
  } catch (err) {
    console.error('Error downloading fonts:', err);
  }
}

main();
