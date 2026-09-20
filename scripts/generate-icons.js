const fs = require('fs');
const path = require('path');
const { loadImage, createCanvas } = require('@napi-rs/canvas');
const pngToIcoRaw = require('png-to-ico');
const pngToIco = pngToIcoRaw.default || pngToIcoRaw;

const sourcePng = 'C:/Users/led14/.gemini/antigravity-ide/brain/778749bc-0bf3-4d66-ab1c-eb5c0aa56355/app_new_icon_1780993418821.png';

const destPngs = [
  path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
  path.join(__dirname, '..', 'build', 'icon_transparent.png')
];

const destIcos = [
  path.join(__dirname, '..', 'renderer', 'assets', 'icon.ico'),
  path.join(__dirname, '..', 'build', 'icon.ico')
];

async function main() {
  try {
    console.log(`Đang đọc nguồn ảnh từ: ${sourcePng}`);
    const img = await loadImage(sourcePng);
    
    // Tạo canvas để chuyển đổi sang PNG chuẩn
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    
    const pngBuffer = canvas.toBuffer('image/png');
    console.log('Đã chuyển đổi ảnh sang định dạng PNG chuẩn.');

    // Ghi file PNG
    destPngs.forEach(dest => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, pngBuffer);
      console.log(`Đã tạo PNG: ${dest}`);
    });

    // Tạo và ghi file ICO chuẩn bằng png-to-ico
    console.log('Đang chuyển đổi sang định dạng ICO đa độ phân giải...');
    const tempPngPath = path.join(__dirname, '..', 'build', 'temp_icon.png');
    fs.writeFileSync(tempPngPath, pngBuffer);
    
    const icoData = await pngToIco(tempPngPath);
    destIcos.forEach(dest => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, icoData);
      console.log(`Đã tạo ICO: ${dest}`);
    });
    
    fs.unlinkSync(tempPngPath);
    console.log('Hoàn thành cập nhật icon ứng dụng!');
  } catch (err) {
    console.error('Lỗi khi sinh icon:', err);
    process.exit(1);
  }
}

main();
